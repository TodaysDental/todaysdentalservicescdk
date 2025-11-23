/**
 * FIX #18: Analytics for Abandoned Calls
 * FIX #19: Sentiment Analysis with Validation
 * 
 * Comprehensive analytics generation for all call end states,
 * including abandoned calls and validated sentiment analysis.
 */

import { TranscribeClient, GetTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { ComprehendClient, DetectSentimentCommand } from '@aws-sdk/client-comprehend';

/**
 * FIX #18: Generate analytics for any terminal call state
 */
export async function generateCallAnalytics(callData: any): Promise<any> {
  const queueEntryTime = new Date(callData.queueEntryTime).getTime();
  const connectedAt = callData.connectedAt ? new Date(callData.connectedAt).getTime() : null;
  const completedAt = callData.completedAt ? new Date(callData.completedAt).getTime() : null;
  const abandonedAt = callData.abandonedAt ? new Date(callData.abandonedAt).getTime() : null;

  // FIXED FLAW #21: Use actual end time from call data, not Date.now()
  const endTime = completedAt || abandonedAt || (callData.endedAt ? new Date(callData.endedAt).getTime() : Date.now());

  // Calculate durations
  // FIX: Queue duration should show wait time even if call was abandoned before connection
  const queueDuration = connectedAt
    ? (connectedAt - queueEntryTime) / 1000
    : abandonedAt
      ? (abandonedAt - queueEntryTime) / 1000  // Time waited before abandoning
      : endTime > queueEntryTime
        ? (endTime - queueEntryTime) / 1000     // Fallback to end time if valid
        : 0;

  // FIXED FLAW #22: Call duration should include abandoned calls that were connected
  const callDuration = connectedAt && (completedAt || abandonedAt)
    ? ((completedAt || abandonedAt)! - connectedAt) / 1000
    : 0;

  const totalDuration = endTime > queueEntryTime ? (endTime - queueEntryTime) / 1000 : 0;

  // FIXED FLAW #23: Add validation for callStatus field before using it
  // Determine abandonment type
  let abandonmentStage: string | null = null;
  if (callData.status === 'abandoned') {
    if (!connectedAt) {
      abandonmentStage = 'queue'; // Abandoned while waiting
    } else if (callData.callStatus && callData.callStatus === 'on_hold') {
      abandonmentStage = 'hold'; // Abandoned while on hold
    } else {
      abandonmentStage = 'ringing'; // Abandoned while ringing
    }
  }

  return {
    callId: callData.callId,
    timestamp: Math.floor(queueEntryTime / 1000),
    clinicId: callData.clinicId,
    agentId: callData.assignedAgentId || null,
    status: callData.status,

    // Durations
    queueDuration,
    ringDuration: callData.ringDuration || 0,
    callDuration,
    holdDuration: callData.holdDuration || 0,
    totalDuration,

    // Call details
    wasTransferred: !!callData.transferredToAgentId,
    transferCount: callData.transferCount || 0,
    wasAbandoned: callData.status === 'abandoned',
    abandonmentStage,
    rejectionCount: callData.rejectionCount || 0,

    // Quality metrics
    agentCount: callData.agentIds?.length || 0,
    attemptCount: callData.ringAttemptCount || 1,

    // Priority
    priority: callData.priority || 'normal',
    isVip: callData.isVip || false,
    isCallback: callData.isCallback || false,

    // TTL
    ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
  };
}

/**
 * FIX #19: Analyze sentiment with validation
 */
export async function analyzeSentiment(callData: any): Promise<{
  overallSentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'UNKNOWN';
  confidence: number;
  agentSentiment?: string;
  customerSentiment?: string;
}> {
  // FIX #19: Check if transcript exists
  if (!callData.transcriptionJobName || !callData.recordingId) {
    console.log(`[Analytics] No transcript for call ${callData.callId}`);
    return {
      overallSentiment: 'UNKNOWN',
      confidence: 0
    };
  }

  // Get transcript from S3
  const transcript = await getTranscript(callData.transcriptionJobName);

  if (!transcript || !transcript.results || transcript.results.transcripts.length === 0) {
    console.log(`[Analytics] Empty transcript for call ${callData.callId}`);
    return {
      overallSentiment: 'UNKNOWN',
      confidence: 0
    };
  }

  const fullText = transcript.results.transcripts[0].transcript;

  // FIX #19: Validate minimum content
  if (fullText.length < 50) {
    console.log(`[Analytics] Transcript too short for analysis: ${fullText.length} chars`);
    return {
      overallSentiment: 'UNKNOWN',
      confidence: 0
    };
  }

  // Analyze by speaker if available
  let agentText = '';
  let customerText = '';

  // FIXED FLAW #24: Better speaker assignment logic
  // Assume spk_0 is agent (first speaker, usually answers), spk_1 is customer
  // Any additional speakers (spk_2+) are ignored or treated as unknowns
  if (transcript.results.speaker_labels && transcript.results.items) {
    try {
      transcript.results.items.forEach((item: any) => {
        // Validate item has required fields
        if (item && item.speaker_label && item.alternatives && item.alternatives[0]) {
          const content = item.alternatives[0].content;
          if (item.speaker_label === 'spk_0') {
            agentText += content + ' ';
          } else if (item.speaker_label === 'spk_1') {
            // Only spk_1 is treated as customer
            customerText += content + ' ';
          }
          // spk_2, spk_3, etc. are ignored (could be transfers or conference calls)
        }
      });
    } catch (err) {
      console.error('[Analytics] Error processing speaker labels:', err);
      // Continue without speaker separation if parsing fails
    }
  } else {
    console.log('[Analytics] No speaker labels available for transcript');
  }

  // Call sentiment analysis service (AWS Comprehend)
  const comprehend = new ComprehendClient({ region: process.env.AWS_REGION });

  try {
    const overallResult = await comprehend.send(new DetectSentimentCommand({
      Text: fullText.substring(0, 5000), // Comprehend limit
      LanguageCode: 'en'
    }));

    let agentSentiment, customerSentiment;

    if (agentText && agentText.length > 50) {
      const agentResult = await comprehend.send(new DetectSentimentCommand({
        Text: agentText.substring(0, 5000),
        LanguageCode: 'en'
      }));
      agentSentiment = agentResult.Sentiment;
    }

    if (customerText && customerText.length > 50) {
      const customerResult = await comprehend.send(new DetectSentimentCommand({
        Text: customerText.substring(0, 5000),
        LanguageCode: 'en'
      }));
      customerSentiment = customerResult.Sentiment;
    }

    return {
      overallSentiment: overallResult.Sentiment as any,
      confidence: Math.max(...Object.values(overallResult.SentimentScore || {})),
      agentSentiment,
      customerSentiment
    };

  } catch (err) {
    console.error('[Analytics] Sentiment analysis failed:', err);
    return {
      overallSentiment: 'UNKNOWN',
      confidence: 0
    };
  }
}

/**
 * Get transcript from Transcribe job
 */
async function getTranscript(jobName: string): Promise<any> {
  try {
    const transcribe = new TranscribeClient({ region: process.env.AWS_REGION });
    const job = await transcribe.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName
    }));

    // The URI is in Transcript.TranscriptFileUri, not directly on TranscriptionJob
    if (job.TranscriptionJob?.Transcript?.TranscriptFileUri) {
      const response = await fetch(job.TranscriptionJob.Transcript.TranscriptFileUri);
      return await response.json();
    }

    return null;
  } catch (err) {
    console.error('[Analytics] Error fetching transcript:', err);
    return null;
  }
}


/**
 * Barge-in Detector
 * 
 * Detects when a caller is speaking during AI speech output,
 * enabling natural conversation interruption.
 * 
 * Key capabilities:
 * - Track AI speaking state per call with auto-timeout
 * - Detect caller speech during AI output
 * - Trigger interrupt actions via UpdateSipMediaApplicationCall
 * - Handle race conditions with DynamoDB state tracking
 * 
 * FIXES:
 * - Uses GSI (callId-index) for DynamoDB queries instead of wrong key structure
 * - Adds auto-timeout for AI speaking state to prevent false positives
 * - Clears speaking state when appropriate
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChimeSDKVoiceClient, UpdateSipMediaApplicationCallCommand } from '@aws-sdk/client-chime-sdk-voice';
import { getSmaIdForClinicSSM } from './sma-map-ssm';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CHIME_MEDIA_REGION = process.env.CHIME_MEDIA_REGION || 'us-east-1';
const chimeClient = new ChimeSDKVoiceClient({ region: CHIME_MEDIA_REGION });
const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME || '';

// Barge-in configuration
const BARGE_IN_MIN_TRANSCRIPT_LENGTH = 5; // Minimum length to trigger barge-in (avoid noise)
const BARGE_IN_COOLDOWN_MS = 2000; // Cooldown between barge-in triggers

// FIX: Auto-timeout for AI speaking state
// If AI has been "speaking" for longer than this, assume something went wrong and clear the state
const AI_SPEAKING_MAX_DURATION_MS = 60 * 1000; // 60 seconds max

// In-memory state for tracking AI speaking status
// This is faster than DynamoDB for real-time detection
interface CallSpeakingState {
  isAiSpeaking: boolean;
  aiSpeakingStartTime: number;
  lastBargeInTime: number;
  pendingInterrupt: boolean;
  // FIX: Track expected speech duration for auto-clear
  expectedSpeechDurationMs?: number;
}

const callSpeakingStates: Map<string, CallSpeakingState> = new Map();

/**
 * Interface for barge-in detection
 */
export interface BargeInDetector {
  /** Check if AI is currently speaking for a call */
  isAiSpeaking(callId: string): boolean;
  
  /** Mark AI as speaking with optional expected duration */
  setAiSpeaking(callId: string, isSpeaking: boolean, expectedDurationMs?: number): void;
  
  /** Detect if caller speech should trigger barge-in */
  onCallerSpeech(callId: string, clinicId: string, transcript: string): Promise<BargeInResult>;
  
  /** Trigger interrupt action */
  interruptCurrentAction(callId: string, clinicId: string, newTranscript: string): Promise<boolean>;
  
  /** Clean up state for a call */
  cleanup(callId: string): void;
  
  /** FIX: Clear speaking state after TTS completes */
  clearSpeakingState(callId: string): void;
}

export interface BargeInResult {
  shouldInterrupt: boolean;
  reason: 'ai_not_speaking' | 'cooldown' | 'transcript_too_short' | 'interrupt_triggered' | 'interrupt_failed' | 'speaking_expired';
}

/**
 * Create a barge-in detector instance
 */
export function createBargeInDetector(): BargeInDetector {
  return {
    isAiSpeaking(callId: string): boolean {
      const state = callSpeakingStates.get(callId);
      if (!state?.isAiSpeaking) return false;
      
      // FIX: Auto-expire speaking state if it's been too long
      const now = Date.now();
      const speakingDuration = now - state.aiSpeakingStartTime;
      
      // Check against expected duration or max duration
      const maxDuration = state.expectedSpeechDurationMs || AI_SPEAKING_MAX_DURATION_MS;
      if (speakingDuration > maxDuration) {
        console.log('[BargeInDetector] AI speaking state auto-expired:', {
          callId,
          speakingDuration,
          maxDuration,
        });
        state.isAiSpeaking = false;
        return false;
      }
      
      return true;
    },

    setAiSpeaking(callId: string, isSpeaking: boolean, expectedDurationMs?: number): void {
      let state = callSpeakingStates.get(callId);
      if (!state) {
        state = {
          isAiSpeaking: false,
          aiSpeakingStartTime: 0,
          lastBargeInTime: 0,
          pendingInterrupt: false,
        };
        callSpeakingStates.set(callId, state);
      }
      
      state.isAiSpeaking = isSpeaking;
      if (isSpeaking) {
        state.aiSpeakingStartTime = Date.now();
        state.expectedSpeechDurationMs = expectedDurationMs;
      } else {
        state.expectedSpeechDurationMs = undefined;
      }
      
      console.log('[BargeInDetector] AI speaking state updated:', {
        callId,
        isAiSpeaking: isSpeaking,
        expectedDurationMs,
      });
    },

    // FIX: Explicit method to clear speaking state after TTS completes
    clearSpeakingState(callId: string): void {
      const state = callSpeakingStates.get(callId);
      if (state) {
        state.isAiSpeaking = false;
        state.expectedSpeechDurationMs = undefined;
        console.log('[BargeInDetector] Cleared speaking state for call:', callId);
      }
    },

    async onCallerSpeech(callId: string, clinicId: string, transcript: string): Promise<BargeInResult> {
      const state = callSpeakingStates.get(callId);
      
      // Check if AI is speaking (includes auto-expiry check)
      if (!this.isAiSpeaking(callId)) {
        return { shouldInterrupt: false, reason: 'ai_not_speaking' };
      }
      
      // Check transcript length
      if (transcript.trim().length < BARGE_IN_MIN_TRANSCRIPT_LENGTH) {
        return { shouldInterrupt: false, reason: 'transcript_too_short' };
      }
      
      // Check cooldown
      const now = Date.now();
      if (state && now - state.lastBargeInTime < BARGE_IN_COOLDOWN_MS) {
        return { shouldInterrupt: false, reason: 'cooldown' };
      }
      
      // Trigger interrupt
      console.log('[BargeInDetector] Barge-in detected:', {
        callId,
        transcript: transcript.substring(0, 50),
        aiSpeakingDuration: state ? now - state.aiSpeakingStartTime : 0,
      });
      
      const success = await this.interruptCurrentAction(callId, clinicId, transcript);
      
      if (success && state) {
        state.lastBargeInTime = now;
        state.isAiSpeaking = false;
        state.pendingInterrupt = true;
        return { shouldInterrupt: true, reason: 'interrupt_triggered' };
      }
      
      return { shouldInterrupt: false, reason: 'interrupt_failed' };
    },

    async interruptCurrentAction(callId: string, clinicId: string, newTranscript: string): Promise<boolean> {
      try {
        const smaId = await getSmaIdForClinicSSM(clinicId);
        if (!smaId) {
          console.error('[BargeInDetector] No SMA ID found for clinic:', clinicId);
          return false;
        }

        // Build interrupt actions:
        // 1. Stop current audio (empty action clears pending)
        // 2. Short pause to acknowledge
        // 3. The transcript bridge will process the new transcript normally
        const interruptActions = [
          {
            Type: 'Pause',
            Parameters: {
              DurationInMilliseconds: '200',
            },
          },
        ];

        await chimeClient.send(new UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: callId,
          Arguments: {
            interruptAction: 'true',
            bargeInTranscript: newTranscript,
            bargeInTime: new Date().toISOString(),
            pendingAiActions: JSON.stringify(interruptActions),
          },
        }));

        console.log('[BargeInDetector] Interrupt action sent:', {
          callId,
          clinicId,
          transcriptLength: newTranscript.length,
        });

        // Update call record to mark pending interrupt
        if (CALL_QUEUE_TABLE) {
          try {
            // FIX: Use GSI (callId-index) to find call record - correct key structure
            const callRecord = await getCallRecordByCallId(callId);
            if (callRecord) {
              await ddb.send(new UpdateCommand({
                TableName: CALL_QUEUE_TABLE,
                Key: {
                  clinicId: callRecord.clinicId,
                  queuePosition: callRecord.queuePosition,
                },
                UpdateExpression: 'SET pendingBargeIn = :bargeIn, bargeInTranscript = :transcript, bargeInTime = :time',
                ExpressionAttributeValues: {
                  ':bargeIn': true,
                  ':transcript': newTranscript,
                  ':time': new Date().toISOString(),
                },
              }));
            }
          } catch (dbError: any) {
            console.warn('[BargeInDetector] Failed to update call record:', dbError.message);
          }
        }

        return true;
      } catch (error: any) {
        console.error('[BargeInDetector] Error sending interrupt:', {
          callId,
          error: error.message,
        });
        return false;
      }
    },

    cleanup(callId: string): void {
      callSpeakingStates.delete(callId);
      console.log('[BargeInDetector] Cleaned up state for call:', callId);
    },
  };
}

/**
 * FIX: Helper to find call record by callId using the correct GSI
 * The CallQueue table uses (clinicId, queuePosition) as primary key,
 * with callId-index GSI for lookups by callId.
 */
async function getCallRecordByCallId(callId: string): Promise<any | null> {
  if (!CALL_QUEUE_TABLE) return null;
  
  try {
    // FIX: Use QueryCommand with GSI instead of GetCommand with wrong key
    const result = await ddb.send(new QueryCommand({
      TableName: CALL_QUEUE_TABLE,
      IndexName: 'callId-index',
      KeyConditionExpression: 'callId = :callId',
      ExpressionAttributeValues: {
        ':callId': callId,
      },
      Limit: 1,
    }));
    
    return result.Items?.[0] || null;
  } catch (error: any) {
    console.warn('[BargeInDetector] Error querying call record:', error.message);
    return null;
  }
}

// Export a singleton instance
export const bargeInDetector = createBargeInDetector();

// Emit metrics for monitoring
export function emitBargeInMetrics(callId: string, result: BargeInResult): void {
  console.log('[METRIC] BargeIn.Detection', {
    callId,
    shouldInterrupt: result.shouldInterrupt,
    reason: result.reason,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get speaking state statistics for monitoring
 */
export function getBargeInStats(): { activeStates: number; callIds: string[] } {
  return {
    activeStates: callSpeakingStates.size,
    callIds: Array.from(callSpeakingStates.keys()),
  };
}

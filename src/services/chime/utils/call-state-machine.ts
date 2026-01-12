/**
 * Call State Machine
 * 
 * Tracks conversation state for real-time voice AI calls.
 * Coordinates between multiple Lambdas (inbound-router, ai-transcript-bridge, voice-ai-handler)
 * to prevent race conditions and ensure proper turn-taking.
 * 
 * States:
 * - LISTENING: Waiting for caller input
 * - PROCESSING: AI is generating a response
 * - SPEAKING: AI is speaking (can be interrupted via barge-in)
 * - INTERRUPTED: Barge-in detected, transitioning back to LISTENING
 * - ENDED: Call has ended
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CALL_QUEUE_TABLE = process.env.CALL_QUEUE_TABLE_NAME || '';

// Call states
export enum CallState {
  LISTENING = 'LISTENING',         // Waiting for caller input
  PROCESSING = 'PROCESSING',       // AI generating response
  SPEAKING = 'SPEAKING',           // AI speaking (can be interrupted)
  INTERRUPTED = 'INTERRUPTED',     // Barge-in detected
  ENDED = 'ENDED',                 // Call ended
}

// Events that trigger state transitions
export enum CallEvent {
  TRANSCRIPT_RECEIVED = 'TRANSCRIPT_RECEIVED',
  AI_RESPONSE_READY = 'AI_RESPONSE_READY',
  TTS_STARTED = 'TTS_STARTED',
  TTS_COMPLETED = 'TTS_COMPLETED',
  BARGE_IN = 'BARGE_IN',
  CALL_ENDED = 'CALL_ENDED',
}

// Valid state transitions
const STATE_TRANSITIONS: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
  [CallState.LISTENING]: {
    [CallEvent.TRANSCRIPT_RECEIVED]: CallState.PROCESSING,
    [CallEvent.CALL_ENDED]: CallState.ENDED,
  },
  [CallState.PROCESSING]: {
    [CallEvent.AI_RESPONSE_READY]: CallState.SPEAKING,
    [CallEvent.BARGE_IN]: CallState.INTERRUPTED, // Can interrupt during processing too
    [CallEvent.CALL_ENDED]: CallState.ENDED,
  },
  [CallState.SPEAKING]: {
    [CallEvent.TTS_COMPLETED]: CallState.LISTENING,
    [CallEvent.BARGE_IN]: CallState.INTERRUPTED,
    [CallEvent.CALL_ENDED]: CallState.ENDED,
  },
  [CallState.INTERRUPTED]: {
    [CallEvent.TRANSCRIPT_RECEIVED]: CallState.PROCESSING, // Process the interrupting utterance
    [CallEvent.CALL_ENDED]: CallState.ENDED,
  },
  [CallState.ENDED]: {
    // Terminal state - no transitions
  },
};

// In-memory state cache for fast lookups
interface CallStateEntry {
  state: CallState;
  lastUpdate: number;
  currentActionId?: string;
  pendingInterrupt?: boolean;
  lastSpeakText?: string;
  processingStartTime?: number;
}

const stateCache: Map<string, CallStateEntry> = new Map();
const STATE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Interface for call state machine
 */
export interface CallStateMachine {
  /** Get current state for a call */
  getState(callId: string): CallState;
  
  /** Transition to a new state based on an event */
  transition(callId: string, event: CallEvent): CallState;
  
  /** Check if a transition is valid */
  canTransition(callId: string, event: CallEvent): boolean;
  
  /** Check if call can be interrupted (barge-in) */
  canInterrupt(callId: string): boolean;
  
  /** Set additional state metadata */
  setMetadata(callId: string, metadata: Partial<CallStateEntry>): void;
  
  /** Get state with metadata */
  getStateWithMetadata(callId: string): CallStateEntry;
  
  /** Initialize state for a new call */
  initializeCall(callId: string): void;
  
  /** Clean up state for an ended call */
  cleanup(callId: string): void;
  
  /** Persist state to DynamoDB (for cross-Lambda coordination) */
  persistState(callId: string, clinicId: string, queuePosition: number): Promise<void>;
  
  /** Load state from DynamoDB */
  loadState(callId: string, clinicId: string, queuePosition: number): Promise<CallState>;
}

/**
 * Create a call state machine instance
 */
export function createCallStateMachine(): CallStateMachine {
  return {
    getState(callId: string): CallState {
      const entry = stateCache.get(callId);
      if (entry && (Date.now() - entry.lastUpdate) < STATE_CACHE_TTL_MS) {
        return entry.state;
      }
      return CallState.LISTENING; // Default to listening
    },

    transition(callId: string, event: CallEvent): CallState {
      const currentState = this.getState(callId);
      const transitions = STATE_TRANSITIONS[currentState];
      const newState = transitions?.[event];
      
      if (newState) {
        const entry: CallStateEntry = stateCache.get(callId) || {
          state: currentState,
          lastUpdate: Date.now(),
        };
        
        entry.state = newState;
        entry.lastUpdate = Date.now();
        
        // Track processing start time
        if (newState === CallState.PROCESSING) {
          entry.processingStartTime = Date.now();
        }
        
        // Clear processing time when done
        if (newState === CallState.LISTENING) {
          entry.processingStartTime = undefined;
        }
        
        stateCache.set(callId, entry);
        
        console.log('[CallStateMachine] State transition:', {
          callId,
          from: currentState,
          event,
          to: newState,
        });
        
        return newState;
      }
      
      console.warn('[CallStateMachine] Invalid transition:', {
        callId,
        currentState,
        event,
      });
      
      return currentState;
    },

    canTransition(callId: string, event: CallEvent): boolean {
      const currentState = this.getState(callId);
      const transitions = STATE_TRANSITIONS[currentState];
      return transitions?.[event] !== undefined;
    },

    canInterrupt(callId: string): boolean {
      const state = this.getState(callId);
      // Can interrupt during SPEAKING or PROCESSING
      return state === CallState.SPEAKING || state === CallState.PROCESSING;
    },

    setMetadata(callId: string, metadata: Partial<CallStateEntry>): void {
      const entry = stateCache.get(callId) || {
        state: CallState.LISTENING,
        lastUpdate: Date.now(),
      };
      
      Object.assign(entry, metadata);
      entry.lastUpdate = Date.now();
      stateCache.set(callId, entry);
    },

    getStateWithMetadata(callId: string): CallStateEntry {
      return stateCache.get(callId) || {
        state: CallState.LISTENING,
        lastUpdate: Date.now(),
      };
    },

    initializeCall(callId: string): void {
      stateCache.set(callId, {
        state: CallState.LISTENING,
        lastUpdate: Date.now(),
      });
      
      console.log('[CallStateMachine] Initialized call:', callId);
    },

    cleanup(callId: string): void {
      stateCache.delete(callId);
      console.log('[CallStateMachine] Cleaned up call:', callId);
    },

    async persistState(callId: string, clinicId: string, queuePosition: number): Promise<void> {
      if (!CALL_QUEUE_TABLE) {
        console.warn('[CallStateMachine] CALL_QUEUE_TABLE not configured');
        return;
      }
      
      const entry = stateCache.get(callId);
      if (!entry) return;
      
      try {
        await ddb.send(new UpdateCommand({
          TableName: CALL_QUEUE_TABLE,
          Key: { clinicId, queuePosition },
          UpdateExpression: 'SET conversationState = :state, conversationStateTime = :time',
          ExpressionAttributeValues: {
            ':state': entry.state,
            ':time': new Date().toISOString(),
          },
        }));
        
        console.log('[CallStateMachine] Persisted state:', {
          callId,
          state: entry.state,
        });
      } catch (error: any) {
        console.error('[CallStateMachine] Failed to persist state:', error.message);
      }
    },

    async loadState(callId: string, clinicId: string, queuePosition: number): Promise<CallState> {
      if (!CALL_QUEUE_TABLE) {
        return CallState.LISTENING;
      }
      
      try {
        const result = await ddb.send(new GetCommand({
          TableName: CALL_QUEUE_TABLE,
          Key: { clinicId, queuePosition },
          ProjectionExpression: 'conversationState',
        }));
        
        const state = result.Item?.conversationState as CallState;
        
        if (state && Object.values(CallState).includes(state)) {
          stateCache.set(callId, {
            state,
            lastUpdate: Date.now(),
          });
          return state;
        }
      } catch (error: any) {
        console.error('[CallStateMachine] Failed to load state:', error.message);
      }
      
      return CallState.LISTENING;
    },
  };
}

// Export singleton instance
export const callStateMachine = createCallStateMachine();

// Cleanup stale entries periodically
export function cleanupStaleStates(): void {
  const now = Date.now();
  for (const [callId, entry] of stateCache.entries()) {
    if (now - entry.lastUpdate > STATE_CACHE_TTL_MS) {
      stateCache.delete(callId);
    }
  }
}

// Get metrics for monitoring
export function getStateMetrics(): { 
  cachedCalls: number; 
  stateDistribution: Record<CallState, number>;
} {
  const distribution: Record<CallState, number> = {
    [CallState.LISTENING]: 0,
    [CallState.PROCESSING]: 0,
    [CallState.SPEAKING]: 0,
    [CallState.INTERRUPTED]: 0,
    [CallState.ENDED]: 0,
  };
  
  for (const entry of stateCache.values()) {
    distribution[entry.state]++;
  }
  
  return {
    cachedCalls: stateCache.size,
    stateDistribution: distribution,
  };
}

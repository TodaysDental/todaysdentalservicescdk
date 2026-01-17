/**
 * Lex Transcript Capture Hook (ASR-only)
 *
 * Purpose:
 * - Used as the Lex V2 code hook for Amazon Connect.
 * - Captures the caller's latest utterance + confidence into Lex session attributes.
 * - Returns a near-silent response so the Amazon Connect contact flow can continue
 *   (Connect will then play the keyboard WAV prompt and invoke Bedrock via Lambda).
 */

// ========================================================================
// TYPES (minimal Lex V2 event/response shapes used by this hook)
// ========================================================================

interface LexV2Event {
  messageVersion: string;
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  inputMode: 'Text' | 'Speech' | 'DTMF';
  responseContentType?: string;
  sessionId: string;
  inputTranscript?: string;
  sessionState: {
    sessionAttributes?: Record<string, string>;
    intent?: {
      name: string;
      state: string;
      confirmationState?: string;
      slots?: Record<string, any>;
    };
    dialogAction?: {
      type: string;
      slotToElicit?: string;
    };
  };
  requestAttributes?: Record<string, string>;
  transcriptions?: Array<{
    transcription: string;
    transcriptionConfidence: number;
  }>;
}

interface LexV2Response {
  sessionState: {
    sessionAttributes?: Record<string, string>;
    dialogAction: {
      type: 'Close' | 'ConfirmIntent' | 'Delegate' | 'ElicitIntent' | 'ElicitSlot';
      slotToElicit?: string;
      fulfillmentState?: 'Fulfilled' | 'Failed' | 'InProgress';
    };
    intent?: {
      name: string;
      state: 'Fulfilled' | 'Failed' | 'InProgress' | 'ReadyForFulfillment';
      confirmationState?: string;
      slots?: Record<string, any>;
    };
  };
  messages?: Array<{
    contentType: 'PlainText' | 'SSML' | 'CustomPayload' | 'ImageResponseCard';
    content: string;
  }>;
  requestAttributes?: Record<string, string>;
}

function cleanTranscript(transcript: string | undefined): string {
  if (!transcript) return '';
  return transcript.trim().replace(/\s+/g, ' ');
}

function clampConfidence(confidence: number | undefined): number {
  if (confidence === undefined || Number.isNaN(confidence)) return 0;
  if (confidence < 0) return 0;
  if (confidence > 1) return 1;
  return confidence;
}

export const handler = async (event: LexV2Event): Promise<LexV2Response> => {
  console.log('[LexTranscriptCapture] Event:', JSON.stringify({
    invocationSource: event.invocationSource,
    inputMode: event.inputMode,
    sessionId: event.sessionId,
    hasTranscript: !!event.inputTranscript,
    hasTranscriptions: Array.isArray(event.transcriptions) && event.transcriptions.length > 0,
    sessionAttrsKeys: Object.keys(event.sessionState?.sessionAttributes || {}),
  }));

  const sessionAttributes = event.sessionState?.sessionAttributes || {};

  const rawTranscript = event.inputTranscript || event.transcriptions?.[0]?.transcription || '';
  const trimmed = cleanTranscript(rawTranscript);
  const confidence = clampConfidence(event.transcriptions?.[0]?.transcriptionConfidence);

  const nextSessionAttributes: Record<string, string> = {
    ...sessionAttributes,
    // Pass transcript to Connect via Lex session attributes
    lastUtterance: trimmed.substring(0, 1000),
    lastUtteranceConfidence: String(confidence),
  };

  // Return a near-silent SSML response. Connect will continue the flow and handle
  // the audible typing WAV prompt + AI response playback.
  return {
    sessionState: {
      sessionAttributes: nextSessionAttributes,
      dialogAction: {
        // Close ends the Lex turn quickly; Connect remains in control of the loop.
        type: 'Close',
        fulfillmentState: 'Fulfilled',
      },
      intent: event.sessionState?.intent
        ? {
            name: event.sessionState.intent.name,
            // Mark fulfilled so Lex doesn't keep the dialog open.
            state: 'Fulfilled',
            confirmationState: event.sessionState.intent.confirmationState,
            slots: event.sessionState.intent.slots,
          }
        : undefined,
    },
    messages: [
      {
        contentType: 'SSML',
        content: '<speak><break time="150ms"/></speak>',
      },
    ],
  };
};

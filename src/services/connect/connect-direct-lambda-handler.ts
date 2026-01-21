/**
 * Amazon Connect Direct Lambda Handler
 * 
 * Invoked directly by Connect (not via Lex) with transcript from GetParticipantInput.
 * 
 * This Lambda:
 * - Receives inputTranscript from Connect's InvokeLambdaFunction block
 * - Calls Bedrock/AI to generate a response
 * - Returns { aiResponse } for Connect to speak
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({});

// Environment variables
const MODEL_ID = process.env.MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are a helpful AI assistant on a phone call. Keep responses concise and natural for voice conversation.';

// Amazon Connect InvokeLambdaFunction has a hard ~8s limit. Keep the Bedrock call comfortably under that
// so the contact flow doesn't time out before playing the first response.
const CONNECT_LAMBDA_HARD_LIMIT_MS = 8000;
const CONNECT_SAFE_MAX_BEDROCK_TIMEOUT_MS = CONNECT_LAMBDA_HARD_LIMIT_MS - 1500;
const CONNECT_BEDROCK_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CONNECT_BEDROCK_TIMEOUT_MS || '6500');
  const n = Number.isFinite(raw) ? raw : 6500;
  return Math.max(1000, Math.min(n, CONNECT_SAFE_MAX_BEDROCK_TIMEOUT_MS));
})();

// ========================================================================
// TYPES - Connect Direct Lambda Event
// ========================================================================

/**
 * Connect invokes Lambda with this structure when using InvokeLambdaFunction
 */
interface ConnectDirectLambdaEvent {
  Details: {
    ContactData: {
      ContactId: string;
      InitialContactId?: string;
      Channel: 'VOICE' | 'CHAT' | 'TASK';
      InstanceARN: string;
      Attributes?: Record<string, string>;
    };
    Parameters: {
      inputTranscript: string;
      callerNumber?: string;
      dialedNumber?: string;
      confidence?: string;
      [key: string]: string | undefined;
    };
  };
}

interface ConnectDirectLambdaResponse {
  aiResponse: string;
  ssmlResponse?: string;
}

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

/**
 * Call Bedrock to generate AI response
 */
async function generateAiResponse(userMessage: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_BEDROCK_TIMEOUT_MS);
  try {
    const response = await bedrockClient.send(new ConverseCommand({
      modelId: MODEL_ID,
      messages: [
        {
          role: 'user',
          content: [{ text: userMessage }],
        },
      ],
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: {
        maxTokens: 200, // Keep responses short for phone calls
        temperature: 0.7,
      },
    }), { abortSignal: controller.signal });

    const aiMessage = response.output?.message?.content?.[0];
    if (aiMessage && 'text' in aiMessage && aiMessage.text) {
      return aiMessage.text;
    }

    return "I'm sorry, I didn't quite catch that. Could you please repeat?";
  } catch (error) {
    const isAbort =
      controller.signal.aborted ||
      (error as any)?.name === 'AbortError' ||
      (error as any)?.code === 'ABORT_ERR';

    if (isAbort) {
      console.warn('[ConnectDirectLambda] Bedrock invocation timed out', { timeoutMs: CONNECT_BEDROCK_TIMEOUT_MS });
      return "I'm sorry — I'm having trouble right now. Could you please try again?";
    }

    console.error('[ConnectDirectLambda] Error calling Bedrock:', error);
    return "I'm sorry, I'm having trouble processing that right now. Please try again.";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Clean and validate transcript
 */
function cleanTranscript(transcript: string | undefined): string {
  if (!transcript) {
    return '';
  }

  // Remove extra whitespace, normalize
  return transcript.trim().replace(/\s+/g, ' ');
}

// ========================================================================
// MAIN HANDLER
// ========================================================================

export const handler = async (
  event: ConnectDirectLambdaEvent
): Promise<ConnectDirectLambdaResponse> => {
  console.log('[ConnectDirectLambda] Received event:', JSON.stringify(event, null, 2));

  const params = event.Details?.Parameters;
  if (!params) {
    console.error('[ConnectDirectLambda] Missing Parameters');
    return {
      aiResponse: "I'm sorry, I didn't receive your message. Please try again.",
    };
  }

  // Extract and clean the transcript
  const inputTranscript = cleanTranscript(params.inputTranscript);
  const callerNumber = params.callerNumber;
  const dialedNumber = params.dialedNumber;
  const confidence = params.confidence;

  console.log('[ConnectDirectLambda] Processing:', {
    inputTranscript,
    callerNumber,
    dialedNumber,
    confidence,
  });

  // Validate transcript
  if (!inputTranscript) {
    console.warn('[ConnectDirectLambda] Empty transcript');
    return {
      aiResponse: "I'm sorry, I didn't hear anything. Could you please speak?",
    };
  }

  // Check confidence score if available (0.0-1.0)
  if (confidence) {
    const confidenceScore = parseFloat(confidence);
    if (confidenceScore < 0.3) {
      console.warn('[ConnectDirectLambda] Low confidence:', confidenceScore);
      return {
        aiResponse: "I'm sorry, I didn't quite understand that. Could you please repeat?",
      };
    }
  }

  // Generate AI response
  const aiResponse = await generateAiResponse(inputTranscript);

  console.log('[ConnectDirectLambda] Generated response:', {
    inputLength: inputTranscript.length,
    responseLength: aiResponse.length,
  });

  return {
    aiResponse,
    // Optionally return SSML version for advanced audio control
    // ssmlResponse: `<speak>${aiResponse}</speak>`,
  };
};

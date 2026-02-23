/**
 * Custom Resource Handler for Creating Async Amazon Connect Contact Flows
 * 
 * This creates a contact flow with the async Lambda pattern:
 * 1. Lex captures caller speech
 * 2. Start async Lambda (returns immediately with requestId)
 * 3. Loop playing keyboard sounds while polling for result
 * 4. When complete, speak AI response
 * 5. Loop for next turn
 * 
 * This overcomes Connect's 8-second sync Lambda limit by using
 * async invocation (up to 60s) while keeping caller engaged with
 * continuous typing sounds.
 */

import {
  ConnectClient,
  CreateContactFlowCommand,
  UpdateContactFlowContentCommand,
  ListContactFlowsCommand,
  DuplicateResourceException,
} from '@aws-sdk/client-connect';

const connectClient = new ConnectClient({});

interface ContactFlowEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    InstanceId: string;
    FlowName: string;
    FlowType: string;
    Description: string;
    LexBotAliasArn: string;
    // Used only for per-clinic voice selection via UpdateContactTextToSpeechVoice
    VoiceConfigLambdaArn: string;
    AsyncLambdaArn: string;
    KeyboardPromptId: string;
    DisconnectFlowArn: string;
    // Maximum number of poll loops (default 15 = ~30 seconds with 2s waits)
    MaxPollLoops?: string;
  };
  PhysicalResourceId?: string;
}

/**
 * Find an existing contact flow by name with pagination support
 */
async function findExistingFlow(
  instanceId: string,
  flowName: string
): Promise<{ id: string; arn: string } | null> {
  let nextToken: string | undefined;

  do {
    const listResult = await connectClient.send(new ListContactFlowsCommand({
      InstanceId: instanceId,
      ContactFlowTypes: ['CONTACT_FLOW'],
      NextToken: nextToken,
      MaxResults: 100,
    }));

    const existingFlow = listResult.ContactFlowSummaryList?.find(
      f => f.Name === flowName
    );

    if (existingFlow) {
      return {
        id: existingFlow.Id!,
        arn: existingFlow.Arn!,
      };
    }

    nextToken = listResult.NextToken;
  } while (nextToken);

  return null;
}

export const handler = async (event: ContactFlowEvent): Promise<any> => {
  console.log('[CreateAsyncContactFlow] Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;

  try {
    if (event.RequestType === 'Delete') {
      return {
        PhysicalResourceId: event.PhysicalResourceId || 'contact-flow-placeholder',
      };
    }

    // Build the async contact flow content
    const flowContent = buildAsyncContactFlowContent({
      lexBotAliasArn: props.LexBotAliasArn,
      voiceConfigLambdaArn: props.VoiceConfigLambdaArn,
      asyncLambdaArn: props.AsyncLambdaArn,
      keyboardPromptId: props.KeyboardPromptId,
      disconnectFlowArn: props.DisconnectFlowArn,
      maxPollLoops: parseInt(props.MaxPollLoops || '15', 10),
    });

    // For both Create and Update, first try to find existing flow
    const existingFlow = await findExistingFlow(props.InstanceId, props.FlowName);

    if (existingFlow) {
      console.log('[CreateAsyncContactFlow] Found existing flow, updating:', existingFlow.arn);

      await connectClient.send(new UpdateContactFlowContentCommand({
        InstanceId: props.InstanceId,
        ContactFlowId: existingFlow.id,
        Content: JSON.stringify(flowContent),
      }));

      return {
        PhysicalResourceId: existingFlow.id,
        Data: {
          ContactFlowId: existingFlow.id,
          ContactFlowArn: existingFlow.arn,
        },
      };
    }

    // No existing flow found, create a new one
    console.log('[CreateAsyncContactFlow] Creating new flow:', props.FlowName);

    try {
      const createResult = await connectClient.send(new CreateContactFlowCommand({
        InstanceId: props.InstanceId,
        Name: props.FlowName,
        Type: props.FlowType as any,
        Description: props.Description,
        Content: JSON.stringify(flowContent),
      }));

      console.log('[CreateAsyncContactFlow] Created contact flow:', createResult.ContactFlowArn);

      return {
        PhysicalResourceId: createResult.ContactFlowId!,
        Data: {
          ContactFlowId: createResult.ContactFlowId!,
          ContactFlowArn: createResult.ContactFlowArn!,
        },
      };
    } catch (createError) {
      if (createError instanceof DuplicateResourceException) {
        console.log('[CreateAsyncContactFlow] Race condition, attempting retry');

        const retryFlow = await findExistingFlow(props.InstanceId, props.FlowName);
        if (retryFlow) {
          await connectClient.send(new UpdateContactFlowContentCommand({
            InstanceId: props.InstanceId,
            ContactFlowId: retryFlow.id,
            Content: JSON.stringify(flowContent),
          }));

          return {
            PhysicalResourceId: retryFlow.id,
            Data: {
              ContactFlowId: retryFlow.id,
              ContactFlowArn: retryFlow.arn,
            },
          };
        }
      }
      throw createError;
    }
  } catch (error: any) {
    console.error('[CreateAsyncContactFlow] Error:', error);
    if (error?.problems) {
      console.error('[CreateAsyncContactFlow] Validation problems:', JSON.stringify(error.problems, null, 2));
    }
    throw error;
  }
};

/**
 * Build the async contact flow with continuous keyboard sound during processing
 * 
 * SIMPLIFIED Flow Architecture (no complex branching in Connect):
 * 
 * welcome → set-attrs → lex-asr → start-async → typing → poll-lambda → speak-ai → loop
 *                                                   ↑                       ↓
 *                                                   └───────────────────────┘
 * 
 * The poll-lambda internally waits up to 7 seconds and returns either:
 * - { status: 'completed', aiResponse: '...' } → flow speaks aiResponse
 * - { status: 'pending', aiResponse: 'One moment...' } → flow speaks short message, loops back
 * 
 * This avoids complex CheckContactAttributes branching by having Lambda return
 * different responses that Connect can speak directly.
 */
function buildAsyncContactFlowContent(params: {
  lexBotAliasArn: string;
  voiceConfigLambdaArn: string;
  asyncLambdaArn: string;
  keyboardPromptId: string;
  disconnectFlowArn: string;
  maxPollLoops: number;
}): any {
  const { lexBotAliasArn, voiceConfigLambdaArn, asyncLambdaArn, keyboardPromptId, disconnectFlowArn, maxPollLoops } = params;

  return {
    Version: '2019-10-30',
    StartAction: 'set-recording',
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        'set-recording': { position: { x: 160, y: 20 } },
        'set-contact-attrs': { position: { x: 360, y: 20 } },
        'invoke-voice-config': { position: { x: 560, y: 20 } },
        'set-tts-voice': { position: { x: 760, y: 20 } },
        'set-default-tts-voice': { position: { x: 860, y: 80 } },
        'store-clinic-id': { position: { x: 960, y: 20 } },
        'welcome-message': { position: { x: 1160, y: 20 } },
        'set-disconnect-flow': { position: { x: 1360, y: 20 } },
        'lex-asr': { position: { x: 1560, y: 20 } },
        'start-async': { position: { x: 1760, y: 20 } },
        'store-request-id': { position: { x: 1960, y: 20 } },
        'typing-sound': { position: { x: 2160, y: 20 } },
        'poll-result': { position: { x: 2360, y: 20 } },
        'check-status': { position: { x: 2560, y: 20 } },
        'speak-ai': { position: { x: 2760, y: 20 } },
        'speak-ai-text-fallback': { position: { x: 2760, y: 120 } },
        'timeout-message': { position: { x: 2360, y: 160 } },
        'disconnect-action': { position: { x: 2960, y: 20 } },
      },
    },
    Actions: [
      // 1) Enable call recording (captures both sides of the automated interaction)
      // Requires the Connect instance to have CALL_RECORDINGS storage configured.
      {
        Identifier: 'set-recording',
        Type: 'UpdateContactRecordingBehavior',
        Parameters: {
          RecordingBehavior: {
            // Record both directions so the recording includes the system/AI prompts and the caller.
            RecordedParticipants: ['Agent', 'Customer'],
          },
        },
        Transitions: {
          NextAction: 'set-contact-attrs',
          // This action does not define error branches in flow language; keep empty arrays (matches Connect sample flows).
          Errors: [],
          Conditions: [],
        },
      },

      // 2) Set contact attributes
      {
        Identifier: 'set-contact-attrs',
        Type: 'UpdateContactAttributes',
        Parameters: {
          Attributes: {
            callerNumber: '$.CustomerEndpoint.Address',
            dialedNumber: '$.SystemEndpoint.Address',
            // Safe defaults so SSML <prosody> never renders invalid attributes.
            // These get overwritten by per-clinic values when voiceConfig succeeds.
            ttsSpeakingRate: 'medium',
            ttsPitch: 'medium',
            ttsVolume: 'medium',
          },
        },
        Transitions: {
          NextAction: 'invoke-voice-config',
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 3) Look up per-clinic voice settings via Lambda (uses dialedNumber -> clinicId mapping)
      {
        Identifier: 'invoke-voice-config',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: voiceConfigLambdaArn,
          InvocationTimeLimitSeconds: '8',
          InvocationType: 'SYNCHRONOUS',
          ResponseValidation: { ResponseType: 'STRING_MAP' },
          LambdaInvocationAttributes: {
            requestType: 'voiceConfig',
            callerNumber: '$.Attributes.callerNumber',
            dialedNumber: '$.Attributes.dialedNumber',
            clinicId: '$.Attributes.clinicId',
          },
        },
        Transitions: {
          NextAction: 'set-tts-voice',
          // Avoid overwriting default prosody attrs with empty $.External.* on Lambda failure.
          Errors: [{ NextAction: 'welcome-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 4) Apply the chosen Polly voice for all subsequent TTS prompts in this contact
      {
        Identifier: 'set-tts-voice',
        Type: 'UpdateContactTextToSpeechVoice',
        Parameters: {
          TextToSpeechVoice: '$.External.TextToSpeechVoice',
          TextToSpeechEngine: '$.External.TextToSpeechEngine',
        },
        Transitions: {
          NextAction: 'store-clinic-id',
          // If the chosen voice/engine is invalid, restore a known-good default voice so TTS stays audible.
          Errors: [{ NextAction: 'set-default-tts-voice', ErrorType: 'NoMatchingError' }],
        },
      },

      // 4b) Fallback voice (ensures TTS doesn't go silent if dynamic Set voice fails)
      {
        Identifier: 'set-default-tts-voice',
        Type: 'UpdateContactTextToSpeechVoice',
        Parameters: {
          TextToSpeechVoice: 'Joanna',
          TextToSpeechEngine: 'neural',
        },
        Transitions: {
          NextAction: 'store-clinic-id',
          Errors: [{ NextAction: 'store-clinic-id', ErrorType: 'NoMatchingError' }],
        },
      },

      // 5) Persist clinicId on the contact for downstream Lambda/Lex reads
      {
        Identifier: 'store-clinic-id',
        Type: 'UpdateContactAttributes',
        Parameters: {
          Attributes: {
            clinicId: '$.External.clinicId',
            ttsSpeakingRate: '$.External.speakingRate',
            ttsPitch: '$.External.pitch',
            ttsVolume: '$.External.volume',
          },
        },
        Transitions: {
          NextAction: 'welcome-message',
          Errors: [{ NextAction: 'welcome-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 6) Welcome message (now uses per-clinic Polly voice)
      {
        Identifier: 'welcome-message',
        Type: 'MessageParticipant',
        Parameters: {
          // IMPORTANT: Keep this greeting static and SSML-safe.
          // Embedded JSONPath inside SSML tag attributes is not reliably substituted
          // by Connect, and can produce invalid SSML that disconnects the caller.
          Text: "Hi! Thank you for calling Today's Dental. How may I help you today?",
        },
        Transitions: {
          NextAction: 'set-disconnect-flow',
          // Fail open: don't disconnect if greeting playback fails.
          Errors: [{ NextAction: 'set-disconnect-flow', ErrorType: 'NoMatchingError' }],
        },
      },

      // 7) Set disconnect flow (CustomerRemaining hook) so Connect runs our finalizer flow
      // when the disconnect event occurs (e.g., for post-contact processing).
      {
        Identifier: 'set-disconnect-flow',
        Type: 'UpdateContactEventHooks',
        Parameters: {
          EventHooks: {
            CustomerRemaining: disconnectFlowArn,
          },
        },
        Transitions: {
          NextAction: 'lex-asr',
          Errors: [{ NextAction: 'lex-asr', ErrorType: 'NoMatchingError' }], // fail open
        },
      },

      // 8) Lex ASR: captures speech, stores in session attributes
      {
        Identifier: 'lex-asr',
        Type: 'ConnectParticipantWithLexBot',
        Parameters: {
          SSML: '<speak><break time="50ms"/></speak>',
          LexV2Bot: {
            AliasArn: lexBotAliasArn,
          },
          LexSessionAttributes: {
            callerNumber: '$.Attributes.callerNumber',
            dialedNumber: '$.Attributes.dialedNumber',
            clinicId: '$.Attributes.clinicId',
          },
        },
        Transitions: {
          NextAction: 'start-async',
          Errors: [
            // If the caller doesn't respond or Lex errors, prompt and try again.
            { NextAction: 'timeout-message', ErrorType: 'InputTimeLimitExceeded' },
            { NextAction: 'start-async', ErrorType: 'NoMatchingCondition' },
            { NextAction: 'timeout-message', ErrorType: 'NoMatchingError' },
          ],
        },
      },

      // 5) Start async Lambda - stores requestId and spawns background Bedrock processing
      {
        Identifier: 'start-async',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: asyncLambdaArn,
          InvocationTimeLimitSeconds: '8',
          InvocationType: 'SYNCHRONOUS',
          ResponseValidation: { ResponseType: 'STRING_MAP' },
          LambdaInvocationAttributes: {
            functionType: 'start',
            inputTranscript: '$.Lex.SessionAttributes.lastUtterance',
            confidence: '$.Lex.SessionAttributes.lastUtteranceConfidence',
            callerNumber: '$.Attributes.callerNumber',
            dialedNumber: '$.Attributes.dialedNumber',
          },
        },
        Transitions: {
          NextAction: 'store-request-id',
          Errors: [{ NextAction: 'timeout-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 6) Store request ID from start Lambda response
      {
        Identifier: 'store-request-id',
        Type: 'UpdateContactAttributes',
        Parameters: {
          Attributes: {
            requestId: '$.External.requestId',
          },
        },
        Transitions: {
          NextAction: 'typing-sound',
          Errors: [{ NextAction: 'typing-sound', ErrorType: 'NoMatchingError' }],
        },
      },

      // 7) Play keyboard typing sound while processing
      {
        Identifier: 'typing-sound',
        Type: 'MessageParticipant',
        Parameters: {
          PromptId: keyboardPromptId,
        },
        Transitions: {
          NextAction: 'poll-result',
          Errors: [{ NextAction: 'poll-result', ErrorType: 'NoMatchingError' }],
        },
      },

      // 8) Poll for result - must be fast. Connect handles looping/typing prompt.
      {
        Identifier: 'poll-result',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: asyncLambdaArn,
          InvocationTimeLimitSeconds: '8',
          InvocationType: 'SYNCHRONOUS',
          ResponseValidation: { ResponseType: 'STRING_MAP' },
          LambdaInvocationAttributes: {
            functionType: 'poll',
            requestId: '$.Attributes.requestId',
            maxPollLoops: String(maxPollLoops),
          },
        },
        Transitions: {
          NextAction: 'check-status',
          Errors: [{ NextAction: 'timeout-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 9) If still pending, loop back to typing. Otherwise speak the AI response.
      // We use Compare because it can branch on any JSONPath expression (including $.External.*).
      {
        Identifier: 'check-status',
        Type: 'Compare',
        Parameters: {
          ComparisonValue: '$.External.status',
        },
        Transitions: {
          // Default: treat unknown statuses as an error -> timeout branch
          NextAction: 'timeout-message',
          Errors: [{ NextAction: 'timeout-message', ErrorType: 'NoMatchingCondition' }],
          Conditions: [
            {
              NextAction: 'typing-sound',
              Condition: { Operator: 'Equals', Operands: ['pending'] },
            },
            {
              NextAction: 'speak-ai',
              Condition: { Operator: 'Equals', Operands: ['completed'] },
            },
            {
              // If Lambda returns an explicit error status but still includes aiResponse/ssmlResponse,
              // speak it instead of the generic flow timeout message.
              NextAction: 'speak-ai',
              Condition: { Operator: 'Equals', Operands: ['error'] },
            },
          ],
        },
      },

      // 10) Speak AI response returned by Lambda (only when completed)
      {
        Identifier: 'speak-ai',
        Type: 'MessageParticipant',
        Parameters: {
          SSML: '$.External.ssmlResponse',
        },
        Transitions: {
          NextAction: 'lex-asr', // Conversation turn complete
          // If SSML rendering fails for any reason, fall back to plain Text.
          Errors: [{ NextAction: 'speak-ai-text-fallback', ErrorType: 'NoMatchingError' }],
        },
      },

      // 10b) Fallback: speak plain text if SSML fails
      {
        Identifier: 'speak-ai-text-fallback',
        Type: 'MessageParticipant',
        Parameters: {
          Text: '$.External.aiResponse',
        },
        Transitions: {
          NextAction: 'lex-asr',
          Errors: [{ NextAction: 'timeout-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 11) Timeout/error message
      {
        Identifier: 'timeout-message',
        Type: 'MessageParticipant',
        Parameters: {
          // Keep error prompt static and SSML-safe.
          Text: "I'm sorry, I'm having trouble right now. Please try again.",
        },
        Transitions: {
          NextAction: 'lex-asr', // Try again with next utterance
          // Fail open: if prompt playback fails, still try to continue the loop.
          Errors: [{ NextAction: 'lex-asr', ErrorType: 'NoMatchingError' }],
        },
      },

      // 12) Disconnect
      {
        Identifier: 'disconnect-action',
        Type: 'DisconnectParticipant',
        Parameters: {},
        Transitions: {},
      },
    ],
  };
}

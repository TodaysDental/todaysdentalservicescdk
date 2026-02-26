/**
 * Custom Resource Handler for Creating Amazon Connect Contact Flows
 * 
 * This Lambda creates contact flows with dynamic references to prompts/resources
 * that aren't known until deployment time.
 */

import {
  ConnectClient,
  CreateContactFlowCommand,
  UpdateContactFlowContentCommand,
  DescribeContactFlowCommand,
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
    LambdaFunctionArn: string;
    KeyboardPromptId: string;
    DisconnectFlowArn: string;
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
  console.log('[CreateContactFlow] Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;

  try {
    if (event.RequestType === 'Delete') {
      // Don't delete the contact flow - let Connect manage it
      return {
        PhysicalResourceId: event.PhysicalResourceId || 'contact-flow-placeholder',
      };
    }

    // Build the contact flow content with all dynamic ARNs/IDs
    const flowContent = buildContactFlowContent({
      lexBotAliasArn: props.LexBotAliasArn,
      lambdaFunctionArn: props.LambdaFunctionArn,
      keyboardPromptId: props.KeyboardPromptId,
      disconnectFlowArn: props.DisconnectFlowArn,
    });

    // For both Create and Update, first try to find existing flow
    const existingFlow = await findExistingFlow(props.InstanceId, props.FlowName);

    if (existingFlow) {
      console.log('[CreateContactFlow] Found existing flow, updating:', existingFlow.arn);
      
      // Update existing flow content
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
    console.log('[CreateContactFlow] No existing flow found, creating new flow:', props.FlowName);
    
    try {
      const createResult = await connectClient.send(new CreateContactFlowCommand({
        InstanceId: props.InstanceId,
        Name: props.FlowName,
        Type: props.FlowType as any,
        Description: props.Description,
        Content: JSON.stringify(flowContent),
      }));

      console.log('[CreateContactFlow] Created contact flow:', createResult.ContactFlowArn);

      return {
        PhysicalResourceId: createResult.ContactFlowId!,
        Data: {
          ContactFlowId: createResult.ContactFlowId!,
          ContactFlowArn: createResult.ContactFlowArn!,
        },
      };
    } catch (createError) {
      // If we get a duplicate resource error, the flow was created between our check and create
      // Try to find it again and update it
      if (createError instanceof DuplicateResourceException) {
        console.log('[CreateContactFlow] Race condition: flow created by another process, attempting to find and update');
        
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
    console.error('[CreateContactFlow] Error:', error);
    // Log the problems array for InvalidContactFlowException
    if (error?.problems) {
      console.error('[CreateContactFlow] Validation problems:', JSON.stringify(error.problems, null, 2));
    }
    throw error;
  }
};

/**
 * Build the inbound contact flow content JSON with dynamic ARNs/IDs
 * 
 * Flow: setAttrs → voiceConfig → callerLookup → welcome → lex-asr → typingOnce → invoke-ai → speak-ai → loop
 *
 * Architecture:
 * - Lex is used for ASR only (code hook stores transcript in Lex session attributes).
 * - Connect plays a short keyboard typing WAV prompt once (Connect PromptId).
 * - Connect invokes a Bedrock Lambda directly with the transcript + caller/dialed numbers.
 * - Connect speaks the AI response returned by Lambda.
 * - The flow loops for multi-turn conversation.
 *
 * IMPORTANT:
 * - GetParticipantInput does NOT support LexV2Bot - only ConnectParticipantWithLexBot does.
 * - The Lex code hook must write `lastUtterance` / `lastUtteranceConfidence` into session attrs.
 * - Connect reads those via `$.Lex.SessionAttributes.lastUtterance`.
 */
function buildContactFlowContent(params: {
  lexBotAliasArn: string;
  lambdaFunctionArn: string;
  keyboardPromptId: string;
  disconnectFlowArn: string;
}): any {
  const { lexBotAliasArn, lambdaFunctionArn, keyboardPromptId, disconnectFlowArn } = params;

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
        'invoke-welcome-message': { position: { x: 1120, y: 20 } },
        'store-welcome-attrs': { position: { x: 1280, y: 20 } },
        'welcome-message': { position: { x: 1440, y: 20 } },
        'welcome-message-static': { position: { x: 1440, y: 120 } },
        'set-disconnect-flow': { position: { x: 1640, y: 20 } },
        'lex-asr': { position: { x: 1840, y: 20 } },
        'typing-once': { position: { x: 2040, y: 20 } },
        'invoke-ai': { position: { x: 2240, y: 20 } },
        'speak-ai': { position: { x: 2440, y: 20 } },
          'speak-ai-text-fallback': { position: { x: 2160, y: 120 } },
        'disconnect-action': { position: { x: 2640, y: 20 } },
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
            // IMPORTANT: Enable automated interaction (IVR/bot) recording; without this,
            // Connect will not produce recordings for bot-only flows (no live agent).
            IVRRecordingBehavior: 'Enabled',
          },
        },
        Transitions: {
          NextAction: 'set-contact-attrs',
          // This action does not define error branches in flow language; keep empty arrays (matches Connect sample flows).
          Errors: [],
          Conditions: [],
        },
      },

      // 2) Set contact attributes (caller/dialed numbers)
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
          LambdaFunctionARN: lambdaFunctionArn,
          InvocationTimeLimitSeconds: '8',
          InvocationType: 'SYNCHRONOUS',
          ResponseValidation: { ResponseType: 'STRING_MAP' },
          LambdaInvocationAttributes: {
            requestType: 'voiceConfig',
            callerNumber: '$.Attributes.callerNumber',
            dialedNumber: '$.Attributes.dialedNumber',
            // For outbound flows, clinicId is often provided as a pre-set contact attribute.
            clinicId: '$.Attributes.clinicId',
          },
        },
        Transitions: {
          // Fail open: if voice config fails, use Connect default voice (Joanna) and continue.
          NextAction: 'set-tts-voice',
          // Avoid overwriting default prosody attrs with empty $.External.* on Lambda failure.
          Errors: [{ NextAction: 'welcome-message-static', ErrorType: 'NoMatchingError' }],
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
          // If voice/engine are invalid, Connect can take the Error branch and TTS may stop working for the contact.
          // Attempt to restore a known-good default voice so prompts/responses are still audible.
          Errors: [{ NextAction: 'set-default-tts-voice', ErrorType: 'NoMatchingError' }],
        },
      },

      // 4b) Fallback to a known-good voice if dynamic Set voice fails
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
          NextAction: 'invoke-welcome-message',
          Errors: [{ NextAction: 'invoke-welcome-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 6) Resolve welcome message (existing patient -> "Hi [FName]...", otherwise AI-agents greeting)
      {
        Identifier: 'invoke-welcome-message',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: lambdaFunctionArn,
          InvocationTimeLimitSeconds: '8',
          InvocationType: 'SYNCHRONOUS',
          ResponseValidation: { ResponseType: 'STRING_MAP' },
          LambdaInvocationAttributes: {
            requestType: 'welcomeMessage',
            callerNumber: '$.Attributes.callerNumber',
            dialedNumber: '$.Attributes.dialedNumber',
            clinicId: '$.Attributes.clinicId',
          },
        },
        Transitions: {
          NextAction: 'store-welcome-attrs',
          // Fail open: fall back to a static greeting if lookup fails
          Errors: [{ NextAction: 'welcome-message-static', ErrorType: 'NoMatchingError' }],
        },
      },

      // 6b) Store welcome/patient attributes on the contact
      {
        Identifier: 'store-welcome-attrs',
        Type: 'UpdateContactAttributes',
        Parameters: {
          Attributes: {
            welcomeMessage: '$.External.welcomeMessage',
            patientName: '$.External.patientName',
            patientFirstName: '$.External.patientFirstName',
            isNewPatient: '$.External.isNewPatient',
            timezone: '$.External.timezone',
            // OpenDental identity (used to avoid re-asking name/DOB in Bedrock Agent)
            PatNum: '$.External.PatNum',
            FName: '$.External.FName',
            LName: '$.External.LName',
            Birthdate: '$.External.Birthdate',
            IsNewPatient: '$.External.IsNewPatient',
          },
        },
        Transitions: {
          NextAction: 'welcome-message',
          Errors: [{ NextAction: 'welcome-message-static', ErrorType: 'NoMatchingError' }],
        },
      },

      // 6c) Welcome message (dynamic text stored in contact attributes; SSML-safe)
      {
        Identifier: 'welcome-message',
        Type: 'MessageParticipant',
        Parameters: {
          Text: '$.Attributes.welcomeMessage',
        },
        Transitions: {
          NextAction: 'set-disconnect-flow',
          // Fail open: don't disconnect if greeting playback fails for any reason.
          Errors: [{ NextAction: 'set-disconnect-flow', ErrorType: 'NoMatchingError' }],
        },
      },

      // 6d) Fallback welcome message if lookup fails
      {
        Identifier: 'welcome-message-static',
        Type: 'MessageParticipant',
        Parameters: {
          Text: "Hi! Thank you for calling Today's Dental. How may I help you today?",
        },
        Transitions: {
          NextAction: 'set-disconnect-flow',
          Errors: [{ NextAction: 'set-disconnect-flow', ErrorType: 'NoMatchingError' }],
        },
      },

      // 7) Set disconnect flow (CustomerRemaining hook) so Connect runs our finalizer flow
      // when the disconnect event occurs (e.g., post-contact processing).
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

      // 8) Lex ASR (single turn): Lex code hook stores transcript in session attrs
      {
        Identifier: 'lex-asr',
        Type: 'ConnectParticipantWithLexBot',
        Parameters: {
          // Keep Connect in control without repeating a spoken prompt on every loop.
          // Connect requires one of PromptId/Text/SSML/LexInitializationData.
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
          NextAction: 'typing-once',
          // Connect requires NoMatchingCondition for this action type
          Errors: [
            // If Lex times out or errors, fail open and continue the flow.
            // The downstream Lambda handles empty/no-input transcripts by asking the caller to repeat.
            { NextAction: 'typing-once', ErrorType: 'InputTimeLimitExceeded' },
            { NextAction: 'typing-once', ErrorType: 'NoMatchingCondition' },
            { NextAction: 'typing-once', ErrorType: 'NoMatchingError' },
          ],
        },
      },

      // 9) Play a SHORT typing sound once (WAV prompt, ~0.8-2.0s)
      {
        Identifier: 'typing-once',
        Type: 'MessageParticipant',
        Parameters: {
          PromptId: keyboardPromptId,
        },
        Transitions: {
          NextAction: 'invoke-ai',
          Errors: [{ NextAction: 'invoke-ai', ErrorType: 'NoMatchingError' }], // fail open
        },
      },

      // 10) Invoke Lambda directly from Connect with the transcript
      {
        Identifier: 'invoke-ai',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: lambdaFunctionArn,
          InvocationTimeLimitSeconds: '8',
          InvocationType: 'SYNCHRONOUS',
          ResponseValidation: { ResponseType: 'STRING_MAP' },
          LambdaInvocationAttributes: {
            inputTranscript: '$.Lex.SessionAttributes.lastUtterance',
            confidence: '$.Lex.SessionAttributes.lastUtteranceConfidence',
            callerNumber: '$.Attributes.callerNumber',
            dialedNumber: '$.Attributes.dialedNumber',
          },
        },
        Transitions: {
          NextAction: 'speak-ai',
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 11) Speak the AI response returned by Lambda
      {
        Identifier: 'speak-ai',
        Type: 'MessageParticipant',
        Parameters: {
          SSML: '$.External.ssmlResponse',
        },
        Transitions: {
          NextAction: 'lex-asr', // loop for next user turn
          // If SSML fails, fall back to plain text so the caller still hears a response.
          Errors: [{ NextAction: 'speak-ai-text-fallback', ErrorType: 'NoMatchingError' }],
        },
      },

      // 11b) Fallback: speak plain text if SSML fails
      {
        Identifier: 'speak-ai-text-fallback',
        Type: 'MessageParticipant',
        Parameters: {
          Text: '$.External.aiResponse',
        },
        Transitions: {
          NextAction: 'lex-asr',
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
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

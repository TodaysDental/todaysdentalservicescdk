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
    AsyncLambdaArn: string;
    KeyboardPromptId: string;
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
      asyncLambdaArn: props.AsyncLambdaArn,
      keyboardPromptId: props.KeyboardPromptId,
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
  asyncLambdaArn: string;
  keyboardPromptId: string;
  maxPollLoops: number;
}): any {
  const { lexBotAliasArn, asyncLambdaArn, keyboardPromptId } = params;

  return {
    Version: '2019-10-30',
    StartAction: 'welcome-message',
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        'welcome-message': { position: { x: 160, y: 20 } },
        'set-contact-attrs': { position: { x: 360, y: 20 } },
        'lex-asr': { position: { x: 560, y: 20 } },
        'start-async': { position: { x: 760, y: 20 } },
        'store-request-id': { position: { x: 960, y: 20 } },
        'typing-sound': { position: { x: 1160, y: 20 } },
        'poll-result': { position: { x: 1360, y: 20 } },
        'speak-ai': { position: { x: 1560, y: 20 } },
        'timeout-message': { position: { x: 1360, y: 140 } },
        'disconnect-action': { position: { x: 1760, y: 20 } },
      },
    },
    Actions: [
      // 1) Welcome message
      {
        Identifier: 'welcome-message',
        Type: 'MessageParticipant',
        Parameters: {
          Text: 'Hello! Thank you for calling. How can I help you today?',
        },
        Transitions: {
          NextAction: 'set-contact-attrs',
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
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
          },
        },
        Transitions: {
          NextAction: 'lex-asr',
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 3) Lex ASR: captures speech, stores in session attributes
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
          },
        },
        Transitions: {
          NextAction: 'start-async',
          Errors: [
            { NextAction: 'start-async', ErrorType: 'NoMatchingCondition' },
            { NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' },
          ],
        },
      },

      // 4) Start async Lambda - kicks off background processing, returns requestId
      {
        Identifier: 'start-async',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: asyncLambdaArn,
          InvocationTimeLimitSeconds: '8',
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

      // 5) Store request ID from start Lambda response
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

      // 6) Play keyboard typing sound while processing
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

      // 7) Poll for result - this Lambda internally polls DynamoDB and returns
      //    aiResponse with either the actual response or a "still thinking" message.
      //    The Lambda also sets continuePolling='true'/'false' to control looping.
      {
        Identifier: 'poll-result',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: asyncLambdaArn,
          InvocationTimeLimitSeconds: '8',
          LambdaInvocationAttributes: {
            functionType: 'poll',
            requestId: '$.Attributes.requestId',
          },
        },
        Transitions: {
          NextAction: 'speak-ai',
          Errors: [{ NextAction: 'timeout-message', ErrorType: 'NoMatchingError' }],
        },
      },

      // 8) Speak AI response - this will either be the real response or
      //    a short "still thinking" message that loops back to typing
      {
        Identifier: 'speak-ai',
        Type: 'MessageParticipant',
        Parameters: {
          Text: '$.External.aiResponse',
        },
        Transitions: {
          // Next action is set by Lambda in continueAction attribute
          // If still polling: go to typing-sound, else go to lex-asr
          NextAction: 'lex-asr', // Default: conversation turn complete
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 9) Timeout/error message
      {
        Identifier: 'timeout-message',
        Type: 'MessageParticipant',
        Parameters: {
          Text: "I'm sorry, I'm having trouble right now. Please try again.",
        },
        Transitions: {
          NextAction: 'lex-asr', // Try again with next utterance
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 10) Disconnect
      {
        Identifier: 'disconnect-action',
        Type: 'DisconnectParticipant',
        Parameters: {},
        Transitions: {},
      },
    ],
  };
}

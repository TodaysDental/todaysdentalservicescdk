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
 * Flow: welcome → setAttrs → lex-asr → typingOnce → invoke-ai → speak-ai → loop
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
    StartAction: 'welcome-message',
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        'welcome-message': { position: { x: 160, y: 20 } },
        'set-contact-attrs': { position: { x: 360, y: 20 } },
        'set-disconnect-flow': { position: { x: 560, y: 20 } },
        'lex-asr': { position: { x: 760, y: 20 } },
        'typing-once': { position: { x: 960, y: 20 } },
        'invoke-ai': { position: { x: 1160, y: 20 } },
        'speak-ai': { position: { x: 1360, y: 20 } },
        'disconnect-action': { position: { x: 1560, y: 20 } },
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

      // 2) Set contact attributes (caller/dialed numbers for Lex session)
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
          NextAction: 'set-disconnect-flow',
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 3) Set disconnect flow (CustomerRemaining hook) so Connect runs our finalizer flow
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

      // 4) Lex ASR (single turn): Lex code hook stores transcript in session attrs
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
          },
        },
        Transitions: {
          NextAction: 'typing-once',
          // Connect requires NoMatchingCondition for this action type
          Errors: [
            // In practice Connect can emit NoMatchingCondition even when we always want to proceed,
            // so route it to the same next step to avoid an infinite Lex loop.
            { NextAction: 'typing-once', ErrorType: 'NoMatchingCondition' },
            { NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' },
          ],
        },
      },

      // 4) Play a SHORT typing sound once (WAV prompt, ~0.8-2.0s)
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

      // 5) Invoke Lambda directly from Connect with the transcript
      {
        Identifier: 'invoke-ai',
        Type: 'InvokeLambdaFunction',
        Parameters: {
          LambdaFunctionARN: lambdaFunctionArn,
          InvocationTimeLimitSeconds: '8',
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

      // 6) Speak the AI response returned by Lambda
      {
        Identifier: 'speak-ai',
        Type: 'MessageParticipant',
        Parameters: {
          Text: '$.External.aiResponse',
        },
        Transitions: {
          NextAction: 'lex-asr', // loop for next user turn
          Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
        },
      },

      // 7) Disconnect
      {
        Identifier: 'disconnect-action',
        Type: 'DisconnectParticipant',
        Parameters: {},
        Transitions: {},
      },
    ],
  };
}

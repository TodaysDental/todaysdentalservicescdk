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

    // Build the contact flow content with the actual prompt ARN and Lex bot
    const flowContent = buildContactFlowContent(
      props.LambdaFunctionArn,
      props.KeyboardPromptId,
      props.LexBotAliasArn
    );

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
  } catch (error) {
    console.error('[CreateContactFlow] Error:', error);
    throw error;
  }
};

/**
 * Build the contact flow content JSON with actual ARNs/IDs
 * Uses ConnectParticipantWithLexBot for speech-to-text (ASR)
 */
function buildContactFlowContent(
  lambdaFunctionArn: string,
  keyboardPromptId: string,
  lexBotAliasArn: string
): any {
  return {
    Version: '2019-10-30',
    StartAction: 'welcome-message',
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        'welcome-message': { position: { x: 160, y: 20 } },
        'lex-bot': { position: { x: 350, y: 20 } },
        'disconnect-action': { position: { x: 540, y: 20 } },
      },
    },
    Actions: [
      // Step 1: Play welcome message
      {
        Identifier: 'welcome-message',
        Type: 'MessageParticipant',
        Parameters: {
          Text: 'Hello! Thank you for calling. How can I help you today?',
        },
        Transitions: {
          NextAction: 'lex-bot',
          Errors: [
            { NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' },
          ],
        },
      },
      // Step 2: Route to Lex bot for speech recognition and conversation
      // Lex handles ASR, invokes Lambda for fulfillment, and speaks response
      {
        Identifier: 'lex-bot',
        Type: 'ConnectParticipantWithLexBot',
        Parameters: {
          LexBot: {
            AliasArn: lexBotAliasArn,
          },
          LexSessionAttributes: {},
        },
        Transitions: {
          NextAction: 'disconnect-action',
          Errors: [
            { NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' },
          ],
        },
      },
      // Disconnect
      {
        Identifier: 'disconnect-action',
        Type: 'DisconnectParticipant',
        Parameters: {},
        Transitions: {},
      },
    ],
  };
}

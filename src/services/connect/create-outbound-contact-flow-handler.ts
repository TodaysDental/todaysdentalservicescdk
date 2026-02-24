/**
 * Custom Resource Lambda: Create/Update the Outbound AI Contact Flow
 *
 * Unlike the inbound flow (hardcoded welcome), the outbound flow:
 *  1) Speaks the dynamic `ai_voice_prompt` passed via StartOutboundVoiceContact Attributes
 *  2) Sets callDirection=outbound as a contact attribute
 *  3) Enters the same Lex ASR → typing → Lambda → speak loop for multi-turn AI conversation
 *
 * This handler is used as a CDK Custom Resource (Provider pattern).
 */
import {
    ConnectClient,
    CreateContactFlowCommand,
    UpdateContactFlowContentCommand,
    ListContactFlowsCommand,
    DuplicateResourceException,
} from '@aws-sdk/client-connect';
import type { CloudFormationCustomResourceEvent } from 'aws-lambda';

const connectClient = new ConnectClient({});

interface FlowProperties {
    InstanceId: string;
    FlowName: string;
    FlowType: string;
    Description: string;
    LexBotAliasArn: string;
    LambdaFunctionArn: string;
    KeyboardPromptId: string;
    DisconnectFlowArn: string;
    UpdateTrigger?: string;
}

export const handler = async (event: CloudFormationCustomResourceEvent) => {
    console.log('[CreateOutboundContactFlow] Event:', JSON.stringify(event, null, 2));

    const requestType = event.RequestType;
    const props = event.ResourceProperties as unknown as FlowProperties;

    if (requestType === 'Delete') {
        console.log('[CreateOutboundContactFlow] Delete requested – leaving flow in place (manual cleanup)');
        return { PhysicalResourceId: event.PhysicalResourceId || 'deleted' };
    }

    // Build the outbound flow content
    const flowContent = buildOutboundFlowContent({
        lexBotAliasArn: props.LexBotAliasArn,
        lambdaFunctionArn: props.LambdaFunctionArn,
        keyboardPromptId: props.KeyboardPromptId,
        disconnectFlowArn: props.DisconnectFlowArn,
    });

    try {
        // Check for existing flow (Update path or re-deploy)
        const existingFlow = await findExistingFlow(props.InstanceId, props.FlowName);

        if (existingFlow) {
            console.log('[CreateOutboundContactFlow] Updating existing flow:', existingFlow.id);
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

        // Create new flow
        console.log('[CreateOutboundContactFlow] Creating new flow:', props.FlowName);
        const createResult = await connectClient.send(new CreateContactFlowCommand({
            InstanceId: props.InstanceId,
            Name: props.FlowName,
            Type: props.FlowType as any,
            Description: props.Description,
            Content: JSON.stringify(flowContent),
        }));

        console.log('[CreateOutboundContactFlow] Created:', createResult.ContactFlowArn);
        return {
            PhysicalResourceId: createResult.ContactFlowId!,
            Data: {
                ContactFlowId: createResult.ContactFlowId!,
                ContactFlowArn: createResult.ContactFlowArn!,
            },
        };
    } catch (createError) {
        if (createError instanceof DuplicateResourceException) {
            console.log('[CreateOutboundContactFlow] Duplicate found, updating');
            const retryFlow = await findExistingFlow(props.InstanceId, props.FlowName);
            if (retryFlow) {
                await connectClient.send(new UpdateContactFlowContentCommand({
                    InstanceId: props.InstanceId,
                    ContactFlowId: retryFlow.id,
                    Content: JSON.stringify(flowContent),
                }));
                return {
                    PhysicalResourceId: retryFlow.id,
                    Data: { ContactFlowId: retryFlow.id, ContactFlowArn: retryFlow.arn },
                };
            }
        }
        console.error('[CreateOutboundContactFlow] Error:', createError);
        if ((createError as any)?.problems) {
            console.error('[CreateOutboundContactFlow] Validation problems:', JSON.stringify((createError as any).problems, null, 2));
        }
        throw createError;
    }
};

async function findExistingFlow(instanceId: string, flowName: string): Promise<{ id: string; arn: string } | null> {
    let nextToken: string | undefined;
    do {
        const resp = await connectClient.send(new ListContactFlowsCommand({
            InstanceId: instanceId,
            ContactFlowTypes: ['CONTACT_FLOW'],
            NextToken: nextToken,
        }));
        for (const flow of resp.ContactFlowSummaryList || []) {
            if (flow.Name === flowName && flow.Id && flow.Arn) {
                return { id: flow.Id, arn: flow.Arn };
            }
        }
        nextToken = resp.NextToken;
    } while (nextToken);
    return null;
}

/**
 * Build the outbound AI contact flow content.
 *
 * Flow:
 *  set-recording → set-outbound-attrs → speak-greeting → set-disconnect-flow
 *  → lex-asr → typing-once → invoke-ai → speak-ai → (loop to lex-asr)
 *
 * Key difference from inbound:
 *  - Greeting reads from `$.Attributes.ai_voice_prompt` (passed via StartOutboundVoiceContact)
 *  - Contact attributes include `callDirection=outbound`
 */
function buildOutboundFlowContent(params: {
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
                'set-recording': { position: { x: 20, y: 20 } },
                'set-outbound-attrs': { position: { x: 160, y: 20 } },
                'invoke-voice-config': { position: { x: 360, y: 20 } },
                'set-tts-voice': { position: { x: 560, y: 20 } },
                'set-default-tts-voice': { position: { x: 660, y: 80 } },
                'store-clinic-id': { position: { x: 760, y: 20 } },
                'speak-greeting': { position: { x: 960, y: 20 } },
                'set-disconnect-flow': { position: { x: 1160, y: 20 } },
                'lex-asr': { position: { x: 1360, y: 20 } },
                'typing-once': { position: { x: 1560, y: 20 } },
                'invoke-ai': { position: { x: 1760, y: 20 } },
                'speak-ai': { position: { x: 1960, y: 20 } },
                'speak-ai-text-fallback': { position: { x: 1960, y: 120 } },
                'disconnect-action': { position: { x: 2160, y: 20 } },
            },
        },
        Actions: [
            // 1) Enable call recording
            {
                Identifier: 'set-recording',
                Type: 'UpdateContactRecordingBehavior',
                Parameters: {
                    RecordingBehavior: {
                        RecordedParticipants: ['Agent', 'Customer'],
                    },
                },
                Transitions: {
                    NextAction: 'set-outbound-attrs',
                    Errors: [],
                    Conditions: [],
                },
            },

            // 2) Set contact attributes (mark as outbound, copy caller/dialed)
            {
                Identifier: 'set-outbound-attrs',
                Type: 'UpdateContactAttributes',
                Parameters: {
                    Attributes: {
                        callDirection: 'outbound',
                        callerNumber: '$.SystemEndpoint.Address',   // outbound: System = source
                        dialedNumber: '$.CustomerEndpoint.Address',  // outbound: Customer = destination
                        // Safe defaults so SSML <prosody> never renders invalid attributes.
                        // These get overwritten by per-clinic values when voiceConfig succeeds.
                        ttsSpeakingRate: 'medium',
                        ttsPitch: 'medium',
                        ttsVolume: 'medium',
                    },
                },
                Transitions: {
                    NextAction: 'invoke-voice-config',
                    Errors: [{ NextAction: 'invoke-voice-config', ErrorType: 'NoMatchingError' }],
                },
            },

            // 3) Look up per-clinic voice settings via Lambda
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
                        clinicId: '$.Attributes.clinicId',
                    },
                },
                Transitions: {
                    NextAction: 'set-tts-voice',
                    // Avoid overwriting default prosody attrs with empty $.External.* on Lambda failure.
                    Errors: [{ NextAction: 'speak-greeting', ErrorType: 'NoMatchingError' }],
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
                    // If dynamic voice/engine is invalid, restore a known-good default voice so TTS remains audible.
                    Errors: [{ NextAction: 'set-default-tts-voice', ErrorType: 'NoMatchingError' }],
                },
            },

            // 4b) Fallback to a safe default voice (prevents silent contacts when Set voice fails)
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
                    NextAction: 'speak-greeting',
                    Errors: [{ NextAction: 'speak-greeting', ErrorType: 'NoMatchingError' }],
                },
            },

            // 6) Speak the AI voice prompt (dynamic, from StartOutboundVoiceContact Attributes)
            {
                Identifier: 'speak-greeting',
                Type: 'MessageParticipant',
                Parameters: {
                    Text: '$.Attributes.ai_voice_prompt',
                },
                Transitions: {
                    NextAction: 'set-disconnect-flow',
                    Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
                },
            },

            // 7) Set disconnect flow for post-call analytics
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
                    Errors: [{ NextAction: 'lex-asr', ErrorType: 'NoMatchingError' }],
                },
            },

            // 8) Lex ASR (captures customer speech, code hook stores transcript in session attrs)
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
                    NextAction: 'typing-once',
                    Errors: [
                        // Fail open on timeouts/errors: downstream Lambda will ask to repeat on empty input.
                        { NextAction: 'typing-once', ErrorType: 'InputTimeLimitExceeded' },
                        { NextAction: 'typing-once', ErrorType: 'NoMatchingCondition' },
                        { NextAction: 'typing-once', ErrorType: 'NoMatchingError' },
                    ],
                },
            },

            // 9) Play keyboard typing sound (thinking indicator)
            {
                Identifier: 'typing-once',
                Type: 'MessageParticipant',
                Parameters: {
                    PromptId: keyboardPromptId,
                },
                Transitions: {
                    NextAction: 'invoke-ai',
                    Errors: [{ NextAction: 'invoke-ai', ErrorType: 'NoMatchingError' }],
                },
            },

            // 10) Invoke Bedrock Lambda with transcript + context
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
                        callDirection: '$.Attributes.callDirection',
                        ai_voice_prompt: '$.Attributes.ai_voice_prompt',
                    },
                },
                Transitions: {
                    NextAction: 'speak-ai',
                    Errors: [{ NextAction: 'disconnect-action', ErrorType: 'NoMatchingError' }],
                },
            },

            // 11) Speak AI response
            {
                Identifier: 'speak-ai',
                Type: 'MessageParticipant',
                Parameters: {
                    SSML: '$.External.ssmlResponse',
                },
                Transitions: {
                    NextAction: 'lex-asr', // loop for next turn
                    // If SSML fails, fall back to plain text so the contact doesn't sound "broken".
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

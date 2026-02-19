"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/services/connect/create-contact-flow-handler.ts
var create_contact_flow_handler_exports = {};
__export(create_contact_flow_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(create_contact_flow_handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var connectClient = new import_client_connect.ConnectClient({});
async function findExistingFlow(instanceId, flowName) {
  let nextToken;
  do {
    const listResult = await connectClient.send(new import_client_connect.ListContactFlowsCommand({
      InstanceId: instanceId,
      ContactFlowTypes: ["CONTACT_FLOW"],
      NextToken: nextToken,
      MaxResults: 100
    }));
    const existingFlow = listResult.ContactFlowSummaryList?.find(
      (f) => f.Name === flowName
    );
    if (existingFlow) {
      return {
        id: existingFlow.Id,
        arn: existingFlow.Arn
      };
    }
    nextToken = listResult.NextToken;
  } while (nextToken);
  return null;
}
var handler = async (event) => {
  console.log("[CreateContactFlow] Event:", JSON.stringify(event, null, 2));
  const props = event.ResourceProperties;
  try {
    if (event.RequestType === "Delete") {
      return {
        PhysicalResourceId: event.PhysicalResourceId || "contact-flow-placeholder"
      };
    }
    const flowContent = buildContactFlowContent({
      lexBotAliasArn: props.LexBotAliasArn,
      lambdaFunctionArn: props.LambdaFunctionArn,
      keyboardPromptId: props.KeyboardPromptId,
      disconnectFlowArn: props.DisconnectFlowArn
    });
    const existingFlow = await findExistingFlow(props.InstanceId, props.FlowName);
    if (existingFlow) {
      console.log("[CreateContactFlow] Found existing flow, updating:", existingFlow.arn);
      await connectClient.send(new import_client_connect.UpdateContactFlowContentCommand({
        InstanceId: props.InstanceId,
        ContactFlowId: existingFlow.id,
        Content: JSON.stringify(flowContent)
      }));
      return {
        PhysicalResourceId: existingFlow.id,
        Data: {
          ContactFlowId: existingFlow.id,
          ContactFlowArn: existingFlow.arn
        }
      };
    }
    console.log("[CreateContactFlow] No existing flow found, creating new flow:", props.FlowName);
    try {
      const createResult = await connectClient.send(new import_client_connect.CreateContactFlowCommand({
        InstanceId: props.InstanceId,
        Name: props.FlowName,
        Type: props.FlowType,
        Description: props.Description,
        Content: JSON.stringify(flowContent)
      }));
      console.log("[CreateContactFlow] Created contact flow:", createResult.ContactFlowArn);
      return {
        PhysicalResourceId: createResult.ContactFlowId,
        Data: {
          ContactFlowId: createResult.ContactFlowId,
          ContactFlowArn: createResult.ContactFlowArn
        }
      };
    } catch (createError) {
      if (createError instanceof import_client_connect.DuplicateResourceException) {
        console.log("[CreateContactFlow] Race condition: flow created by another process, attempting to find and update");
        const retryFlow = await findExistingFlow(props.InstanceId, props.FlowName);
        if (retryFlow) {
          await connectClient.send(new import_client_connect.UpdateContactFlowContentCommand({
            InstanceId: props.InstanceId,
            ContactFlowId: retryFlow.id,
            Content: JSON.stringify(flowContent)
          }));
          return {
            PhysicalResourceId: retryFlow.id,
            Data: {
              ContactFlowId: retryFlow.id,
              ContactFlowArn: retryFlow.arn
            }
          };
        }
      }
      throw createError;
    }
  } catch (error) {
    console.error("[CreateContactFlow] Error:", error);
    if (error?.problems) {
      console.error("[CreateContactFlow] Validation problems:", JSON.stringify(error.problems, null, 2));
    }
    throw error;
  }
};
function buildContactFlowContent(params) {
  const { lexBotAliasArn, lambdaFunctionArn, keyboardPromptId, disconnectFlowArn } = params;
  return {
    Version: "2019-10-30",
    StartAction: "set-recording",
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        "set-recording": { position: { x: 160, y: 20 } },
        "set-contact-attrs": { position: { x: 360, y: 20 } },
        "invoke-voice-config": { position: { x: 560, y: 20 } },
        "set-tts-voice": { position: { x: 760, y: 20 } },
        "store-clinic-id": { position: { x: 960, y: 20 } },
        "welcome-message": { position: { x: 1160, y: 20 } },
        "set-disconnect-flow": { position: { x: 1360, y: 20 } },
        "lex-asr": { position: { x: 1560, y: 20 } },
        "typing-once": { position: { x: 1760, y: 20 } },
        "invoke-ai": { position: { x: 1960, y: 20 } },
        "speak-ai": { position: { x: 2160, y: 20 } },
        "disconnect-action": { position: { x: 2360, y: 20 } }
      }
    },
    Actions: [
      // 1) Enable call recording (captures both sides of the automated interaction)
      // Requires the Connect instance to have CALL_RECORDINGS storage configured.
      {
        Identifier: "set-recording",
        Type: "UpdateContactRecordingBehavior",
        Parameters: {
          RecordingBehavior: {
            // Record both directions so the recording includes the system/AI prompts and the caller.
            RecordedParticipants: ["Agent", "Customer"]
          }
        },
        Transitions: {
          NextAction: "set-contact-attrs",
          // This action does not define error branches in flow language; keep empty arrays (matches Connect sample flows).
          Errors: [],
          Conditions: []
        }
      },
      // 2) Set contact attributes (caller/dialed numbers)
      {
        Identifier: "set-contact-attrs",
        Type: "UpdateContactAttributes",
        Parameters: {
          Attributes: {
            callerNumber: "$.CustomerEndpoint.Address",
            dialedNumber: "$.SystemEndpoint.Address",
            // Safe defaults so SSML <prosody> never renders invalid attributes.
            // These get overwritten by per-clinic values when voiceConfig succeeds.
            ttsSpeakingRate: "medium",
            ttsPitch: "medium",
            ttsVolume: "medium"
          }
        },
        Transitions: {
          NextAction: "invoke-voice-config",
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 3) Look up per-clinic voice settings via Lambda (uses dialedNumber -> clinicId mapping)
      {
        Identifier: "invoke-voice-config",
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: lambdaFunctionArn,
          InvocationTimeLimitSeconds: "8",
          LambdaInvocationAttributes: {
            requestType: "voiceConfig",
            callerNumber: "$.Attributes.callerNumber",
            dialedNumber: "$.Attributes.dialedNumber",
            // For outbound flows, clinicId is often provided as a pre-set contact attribute.
            clinicId: "$.Attributes.clinicId"
          }
        },
        Transitions: {
          // Fail open: if voice config fails, use Connect default voice (Joanna) and continue.
          NextAction: "set-tts-voice",
          // Avoid overwriting default prosody attrs with empty $.External.* on Lambda failure.
          Errors: [{ NextAction: "welcome-message", ErrorType: "NoMatchingError" }]
        }
      },
      // 4) Apply the chosen Polly voice for all subsequent TTS prompts in this contact
      {
        Identifier: "set-tts-voice",
        Type: "UpdateContactTextToSpeechVoice",
        Parameters: {
          TextToSpeechVoice: "$.External.TextToSpeechVoice",
          TextToSpeechEngine: "$.External.TextToSpeechEngine"
        },
        Transitions: {
          // Fail open: proceed even if voice/engine was invalid; Connect will fall back to default voice.
          NextAction: "store-clinic-id",
          Errors: [{ NextAction: "store-clinic-id", ErrorType: "NoMatchingError" }]
        }
      },
      // 5) Persist clinicId on the contact for downstream Lambda/Lex reads
      {
        Identifier: "store-clinic-id",
        Type: "UpdateContactAttributes",
        Parameters: {
          Attributes: {
            clinicId: "$.External.clinicId",
            ttsSpeakingRate: "$.External.speakingRate",
            ttsPitch: "$.External.pitch",
            ttsVolume: "$.External.volume"
          }
        },
        Transitions: {
          NextAction: "welcome-message",
          Errors: [{ NextAction: "welcome-message", ErrorType: "NoMatchingError" }]
        }
      },
      // 6) Welcome message (now uses per-clinic Polly voice)
      {
        Identifier: "welcome-message",
        Type: "MessageParticipant",
        Parameters: {
          // IMPORTANT: Keep this greeting static and SSML-safe.
          // Amazon Connect reliably supports dynamic JSONPath values when the *entire*
          // parameter is a JSONPath (e.g. `$.Attributes.foo`), but does not reliably
          // substitute JSONPath references embedded *inside* SSML tag attributes.
          // A malformed SSML greeting can cause the contact to error out and disconnect.
          Text: "Hello! Thank you for calling. How can I help you today?"
        },
        Transitions: {
          NextAction: "set-disconnect-flow",
          // Fail open: don't disconnect if greeting playback fails for any reason.
          Errors: [{ NextAction: "set-disconnect-flow", ErrorType: "NoMatchingError" }]
        }
      },
      // 7) Set disconnect flow (CustomerRemaining hook) so Connect runs our finalizer flow
      // when the disconnect event occurs (e.g., post-contact processing).
      {
        Identifier: "set-disconnect-flow",
        Type: "UpdateContactEventHooks",
        Parameters: {
          EventHooks: {
            CustomerRemaining: disconnectFlowArn
          }
        },
        Transitions: {
          NextAction: "lex-asr",
          Errors: [{ NextAction: "lex-asr", ErrorType: "NoMatchingError" }]
          // fail open
        }
      },
      // 8) Lex ASR (single turn): Lex code hook stores transcript in session attrs
      {
        Identifier: "lex-asr",
        Type: "ConnectParticipantWithLexBot",
        Parameters: {
          // Keep Connect in control without repeating a spoken prompt on every loop.
          // Connect requires one of PromptId/Text/SSML/LexInitializationData.
          SSML: '<speak><break time="50ms"/></speak>',
          LexV2Bot: {
            AliasArn: lexBotAliasArn
          },
          LexSessionAttributes: {
            callerNumber: "$.Attributes.callerNumber",
            dialedNumber: "$.Attributes.dialedNumber",
            clinicId: "$.Attributes.clinicId"
          }
        },
        Transitions: {
          NextAction: "typing-once",
          // Connect requires NoMatchingCondition for this action type
          Errors: [
            // If Lex times out or errors, fail open and continue the flow.
            // The downstream Lambda handles empty/no-input transcripts by asking the caller to repeat.
            { NextAction: "typing-once", ErrorType: "InputTimeLimitExceeded" },
            { NextAction: "typing-once", ErrorType: "NoMatchingCondition" },
            { NextAction: "typing-once", ErrorType: "NoMatchingError" }
          ]
        }
      },
      // 9) Play a SHORT typing sound once (WAV prompt, ~0.8-2.0s)
      {
        Identifier: "typing-once",
        Type: "MessageParticipant",
        Parameters: {
          PromptId: keyboardPromptId
        },
        Transitions: {
          NextAction: "invoke-ai",
          Errors: [{ NextAction: "invoke-ai", ErrorType: "NoMatchingError" }]
          // fail open
        }
      },
      // 10) Invoke Lambda directly from Connect with the transcript
      {
        Identifier: "invoke-ai",
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: lambdaFunctionArn,
          InvocationTimeLimitSeconds: "8",
          LambdaInvocationAttributes: {
            inputTranscript: "$.Lex.SessionAttributes.lastUtterance",
            confidence: "$.Lex.SessionAttributes.lastUtteranceConfidence",
            callerNumber: "$.Attributes.callerNumber",
            dialedNumber: "$.Attributes.dialedNumber"
          }
        },
        Transitions: {
          NextAction: "speak-ai",
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 11) Speak the AI response returned by Lambda
      {
        Identifier: "speak-ai",
        Type: "MessageParticipant",
        Parameters: {
          SSML: "$.External.ssmlResponse"
        },
        Transitions: {
          NextAction: "lex-asr",
          // loop for next user turn
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 12) Disconnect
      {
        Identifier: "disconnect-action",
        Type: "DisconnectParticipant",
        Parameters: {},
        Transitions: {}
      }
    ]
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

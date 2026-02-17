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

// src/services/connect/create-async-contact-flow-handler.ts
var create_async_contact_flow_handler_exports = {};
__export(create_async_contact_flow_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(create_async_contact_flow_handler_exports);
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
  console.log("[CreateAsyncContactFlow] Event:", JSON.stringify(event, null, 2));
  const props = event.ResourceProperties;
  try {
    if (event.RequestType === "Delete") {
      return {
        PhysicalResourceId: event.PhysicalResourceId || "contact-flow-placeholder"
      };
    }
    const flowContent = buildAsyncContactFlowContent({
      lexBotAliasArn: props.LexBotAliasArn,
      asyncLambdaArn: props.AsyncLambdaArn,
      keyboardPromptId: props.KeyboardPromptId,
      disconnectFlowArn: props.DisconnectFlowArn,
      maxPollLoops: parseInt(props.MaxPollLoops || "15", 10)
    });
    const existingFlow = await findExistingFlow(props.InstanceId, props.FlowName);
    if (existingFlow) {
      console.log("[CreateAsyncContactFlow] Found existing flow, updating:", existingFlow.arn);
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
    console.log("[CreateAsyncContactFlow] Creating new flow:", props.FlowName);
    try {
      const createResult = await connectClient.send(new import_client_connect.CreateContactFlowCommand({
        InstanceId: props.InstanceId,
        Name: props.FlowName,
        Type: props.FlowType,
        Description: props.Description,
        Content: JSON.stringify(flowContent)
      }));
      console.log("[CreateAsyncContactFlow] Created contact flow:", createResult.ContactFlowArn);
      return {
        PhysicalResourceId: createResult.ContactFlowId,
        Data: {
          ContactFlowId: createResult.ContactFlowId,
          ContactFlowArn: createResult.ContactFlowArn
        }
      };
    } catch (createError) {
      if (createError instanceof import_client_connect.DuplicateResourceException) {
        console.log("[CreateAsyncContactFlow] Race condition, attempting retry");
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
    console.error("[CreateAsyncContactFlow] Error:", error);
    if (error?.problems) {
      console.error("[CreateAsyncContactFlow] Validation problems:", JSON.stringify(error.problems, null, 2));
    }
    throw error;
  }
};
function buildAsyncContactFlowContent(params) {
  const { lexBotAliasArn, asyncLambdaArn, keyboardPromptId, disconnectFlowArn, maxPollLoops } = params;
  return {
    Version: "2019-10-30",
    StartAction: "set-recording",
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        "welcome-message": { position: { x: 160, y: 20 } },
        "set-recording": { position: { x: 260, y: 20 } },
        "set-contact-attrs": { position: { x: 360, y: 20 } },
        "set-disconnect-flow": { position: { x: 560, y: 20 } },
        "lex-asr": { position: { x: 760, y: 20 } },
        "start-async": { position: { x: 960, y: 20 } },
        "store-request-id": { position: { x: 1160, y: 20 } },
        "typing-sound": { position: { x: 1360, y: 20 } },
        "poll-result": { position: { x: 1560, y: 20 } },
        "check-status": { position: { x: 1760, y: 20 } },
        "speak-ai": { position: { x: 1960, y: 20 } },
        "timeout-message": { position: { x: 1560, y: 160 } },
        "disconnect-action": { position: { x: 2160, y: 20 } }
      }
    },
    Actions: [
      // 1) Welcome message
      {
        Identifier: "welcome-message",
        Type: "MessageParticipant",
        Parameters: {
          Text: "Hello! Thank you for calling. How can I help you today?"
        },
        Transitions: {
          NextAction: "set-contact-attrs",
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 2) Enable call recording (captures both sides of the automated interaction)
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
          NextAction: "welcome-message",
          // This action does not define error branches in flow language; keep empty arrays (matches Connect sample flows).
          Errors: [],
          Conditions: []
        }
      },
      // 2) Set contact attributes
      {
        Identifier: "set-contact-attrs",
        Type: "UpdateContactAttributes",
        Parameters: {
          Attributes: {
            callerNumber: "$.CustomerEndpoint.Address",
            dialedNumber: "$.SystemEndpoint.Address"
          }
        },
        Transitions: {
          NextAction: "set-disconnect-flow",
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 3) Set disconnect flow (CustomerRemaining hook) so Connect runs our finalizer flow
      // when the disconnect event occurs (e.g., for post-contact processing).
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
      // 4) Lex ASR: captures speech, stores in session attributes
      {
        Identifier: "lex-asr",
        Type: "ConnectParticipantWithLexBot",
        Parameters: {
          SSML: '<speak><break time="50ms"/></speak>',
          LexV2Bot: {
            AliasArn: lexBotAliasArn
          },
          LexSessionAttributes: {
            callerNumber: "$.Attributes.callerNumber",
            dialedNumber: "$.Attributes.dialedNumber"
          }
        },
        Transitions: {
          NextAction: "start-async",
          Errors: [
            { NextAction: "start-async", ErrorType: "NoMatchingCondition" },
            { NextAction: "disconnect-action", ErrorType: "NoMatchingError" }
          ]
        }
      },
      // 5) Start async Lambda - stores requestId and spawns background Bedrock processing
      {
        Identifier: "start-async",
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: asyncLambdaArn,
          InvocationTimeLimitSeconds: "8",
          LambdaInvocationAttributes: {
            functionType: "start",
            inputTranscript: "$.Lex.SessionAttributes.lastUtterance",
            confidence: "$.Lex.SessionAttributes.lastUtteranceConfidence",
            callerNumber: "$.Attributes.callerNumber",
            dialedNumber: "$.Attributes.dialedNumber"
          }
        },
        Transitions: {
          NextAction: "store-request-id",
          Errors: [{ NextAction: "timeout-message", ErrorType: "NoMatchingError" }]
        }
      },
      // 6) Store request ID from start Lambda response
      {
        Identifier: "store-request-id",
        Type: "UpdateContactAttributes",
        Parameters: {
          Attributes: {
            requestId: "$.External.requestId"
          }
        },
        Transitions: {
          NextAction: "typing-sound",
          Errors: [{ NextAction: "typing-sound", ErrorType: "NoMatchingError" }]
        }
      },
      // 7) Play keyboard typing sound while processing
      {
        Identifier: "typing-sound",
        Type: "MessageParticipant",
        Parameters: {
          PromptId: keyboardPromptId
        },
        Transitions: {
          NextAction: "poll-result",
          Errors: [{ NextAction: "poll-result", ErrorType: "NoMatchingError" }]
        }
      },
      // 8) Poll for result - must be fast. Connect handles looping/typing prompt.
      {
        Identifier: "poll-result",
        Type: "InvokeLambdaFunction",
        Parameters: {
          LambdaFunctionARN: asyncLambdaArn,
          InvocationTimeLimitSeconds: "8",
          LambdaInvocationAttributes: {
            functionType: "poll",
            requestId: "$.Attributes.requestId",
            maxPollLoops: String(maxPollLoops)
          }
        },
        Transitions: {
          NextAction: "check-status",
          Errors: [{ NextAction: "timeout-message", ErrorType: "NoMatchingError" }]
        }
      },
      // 9) If still pending, loop back to typing. Otherwise speak the AI response.
      // We use Compare because it can branch on any JSONPath expression (including $.External.*).
      {
        Identifier: "check-status",
        Type: "Compare",
        Parameters: {
          ComparisonValue: "$.External.status"
        },
        Transitions: {
          // Default: treat unknown statuses as an error -> timeout branch
          NextAction: "timeout-message",
          Errors: [{ NextAction: "timeout-message", ErrorType: "NoMatchingCondition" }],
          Conditions: [
            {
              NextAction: "typing-sound",
              Condition: { Operator: "Equals", Operands: ["pending"] }
            },
            {
              NextAction: "speak-ai",
              Condition: { Operator: "Equals", Operands: ["completed"] }
            }
          ]
        }
      },
      // 10) Speak AI response returned by Lambda (only when completed)
      {
        Identifier: "speak-ai",
        Type: "MessageParticipant",
        Parameters: {
          Text: "$.External.aiResponse"
        },
        Transitions: {
          NextAction: "lex-asr",
          // Conversation turn complete
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 11) Timeout/error message
      {
        Identifier: "timeout-message",
        Type: "MessageParticipant",
        Parameters: {
          Text: "I'm sorry, I'm having trouble right now. Please try again."
        },
        Transitions: {
          NextAction: "lex-asr",
          // Try again with next utterance
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

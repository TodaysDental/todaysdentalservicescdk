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

// src/services/connect/create-outbound-contact-flow-handler.ts
var create_outbound_contact_flow_handler_exports = {};
__export(create_outbound_contact_flow_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(create_outbound_contact_flow_handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var connectClient = new import_client_connect.ConnectClient({});
var handler = async (event) => {
  console.log("[CreateOutboundContactFlow] Event:", JSON.stringify(event, null, 2));
  const requestType = event.RequestType;
  const props = event.ResourceProperties;
  if (requestType === "Delete") {
    console.log("[CreateOutboundContactFlow] Delete requested \u2013 leaving flow in place (manual cleanup)");
    return { PhysicalResourceId: event.PhysicalResourceId || "deleted" };
  }
  const flowContent = buildOutboundFlowContent({
    lexBotAliasArn: props.LexBotAliasArn,
    lambdaFunctionArn: props.LambdaFunctionArn,
    keyboardPromptId: props.KeyboardPromptId,
    disconnectFlowArn: props.DisconnectFlowArn
  });
  try {
    const existingFlow = await findExistingFlow(props.InstanceId, props.FlowName);
    if (existingFlow) {
      console.log("[CreateOutboundContactFlow] Updating existing flow:", existingFlow.id);
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
    console.log("[CreateOutboundContactFlow] Creating new flow:", props.FlowName);
    const createResult = await connectClient.send(new import_client_connect.CreateContactFlowCommand({
      InstanceId: props.InstanceId,
      Name: props.FlowName,
      Type: props.FlowType,
      Description: props.Description,
      Content: JSON.stringify(flowContent)
    }));
    console.log("[CreateOutboundContactFlow] Created:", createResult.ContactFlowArn);
    return {
      PhysicalResourceId: createResult.ContactFlowId,
      Data: {
        ContactFlowId: createResult.ContactFlowId,
        ContactFlowArn: createResult.ContactFlowArn
      }
    };
  } catch (createError) {
    if (createError instanceof import_client_connect.DuplicateResourceException) {
      console.log("[CreateOutboundContactFlow] Duplicate found, updating");
      const retryFlow = await findExistingFlow(props.InstanceId, props.FlowName);
      if (retryFlow) {
        await connectClient.send(new import_client_connect.UpdateContactFlowContentCommand({
          InstanceId: props.InstanceId,
          ContactFlowId: retryFlow.id,
          Content: JSON.stringify(flowContent)
        }));
        return {
          PhysicalResourceId: retryFlow.id,
          Data: { ContactFlowId: retryFlow.id, ContactFlowArn: retryFlow.arn }
        };
      }
    }
    console.error("[CreateOutboundContactFlow] Error:", createError);
    if (createError?.problems) {
      console.error("[CreateOutboundContactFlow] Validation problems:", JSON.stringify(createError.problems, null, 2));
    }
    throw createError;
  }
};
async function findExistingFlow(instanceId, flowName) {
  let nextToken;
  do {
    const resp = await connectClient.send(new import_client_connect.ListContactFlowsCommand({
      InstanceId: instanceId,
      ContactFlowTypes: ["CONTACT_FLOW"],
      NextToken: nextToken
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
function buildOutboundFlowContent(params) {
  const { lexBotAliasArn, lambdaFunctionArn, keyboardPromptId, disconnectFlowArn } = params;
  return {
    Version: "2019-10-30",
    StartAction: "set-recording",
    Metadata: {
      entryPointPosition: { x: 20, y: 20 },
      ActionMetadata: {
        "set-recording": { position: { x: 20, y: 20 } },
        "set-outbound-attrs": { position: { x: 160, y: 20 } },
        "speak-greeting": { position: { x: 360, y: 20 } },
        "set-disconnect-flow": { position: { x: 560, y: 20 } },
        "lex-asr": { position: { x: 760, y: 20 } },
        "typing-once": { position: { x: 960, y: 20 } },
        "invoke-ai": { position: { x: 1160, y: 20 } },
        "speak-ai": { position: { x: 1360, y: 20 } },
        "disconnect-action": { position: { x: 1560, y: 20 } }
      }
    },
    Actions: [
      // 1) Enable call recording
      {
        Identifier: "set-recording",
        Type: "UpdateContactRecordingBehavior",
        Parameters: {
          RecordingBehavior: {
            RecordedParticipants: ["Agent", "Customer"]
          }
        },
        Transitions: {
          NextAction: "set-outbound-attrs",
          Errors: [],
          Conditions: []
        }
      },
      // 2) Set contact attributes (mark as outbound, copy caller/dialed)
      {
        Identifier: "set-outbound-attrs",
        Type: "UpdateContactAttributes",
        Parameters: {
          Attributes: {
            callDirection: "outbound",
            callerNumber: "$.SystemEndpoint.Address",
            // outbound: System = source
            dialedNumber: "$.CustomerEndpoint.Address"
            // outbound: Customer = destination
          }
        },
        Transitions: {
          NextAction: "speak-greeting",
          Errors: [{ NextAction: "speak-greeting", ErrorType: "NoMatchingError" }]
        }
      },
      // 3) Speak the AI voice prompt (dynamic, from StartOutboundVoiceContact Attributes)
      {
        Identifier: "speak-greeting",
        Type: "MessageParticipant",
        Parameters: {
          Text: "$.Attributes.ai_voice_prompt"
        },
        Transitions: {
          NextAction: "set-disconnect-flow",
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 4) Set disconnect flow for post-call analytics
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
        }
      },
      // 5) Lex ASR (captures customer speech, code hook stores transcript in session attrs)
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
          NextAction: "typing-once",
          Errors: [
            { NextAction: "typing-once", ErrorType: "NoMatchingCondition" },
            { NextAction: "disconnect-action", ErrorType: "NoMatchingError" }
          ]
        }
      },
      // 6) Play keyboard typing sound (thinking indicator)
      {
        Identifier: "typing-once",
        Type: "MessageParticipant",
        Parameters: {
          PromptId: keyboardPromptId
        },
        Transitions: {
          NextAction: "invoke-ai",
          Errors: [{ NextAction: "invoke-ai", ErrorType: "NoMatchingError" }]
        }
      },
      // 7) Invoke Bedrock Lambda with transcript + context
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
            dialedNumber: "$.Attributes.dialedNumber",
            callDirection: "$.Attributes.callDirection",
            ai_voice_prompt: "$.Attributes.ai_voice_prompt"
          }
        },
        Transitions: {
          NextAction: "speak-ai",
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 8) Speak AI response
      {
        Identifier: "speak-ai",
        Type: "MessageParticipant",
        Parameters: {
          Text: "$.External.aiResponse"
        },
        Transitions: {
          NextAction: "lex-asr",
          // loop for next turn
          Errors: [{ NextAction: "disconnect-action", ErrorType: "NoMatchingError" }]
        }
      },
      // 9) Disconnect
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

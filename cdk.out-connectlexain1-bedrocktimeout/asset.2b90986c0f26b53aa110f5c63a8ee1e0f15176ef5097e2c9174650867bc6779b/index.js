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

// src/services/connect/connect-direct-lambda-handler.ts
var connect_direct_lambda_handler_exports = {};
__export(connect_direct_lambda_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(connect_direct_lambda_handler_exports);
var import_client_bedrock_runtime = require("@aws-sdk/client-bedrock-runtime");
var bedrockClient = new import_client_bedrock_runtime.BedrockRuntimeClient({});
var MODEL_ID = process.env.MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0";
var SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "You are a helpful AI assistant on a phone call. Keep responses concise and natural for voice conversation.";
async function generateAiResponse(userMessage) {
  try {
    const response = await bedrockClient.send(new import_client_bedrock_runtime.ConverseCommand({
      modelId: MODEL_ID,
      messages: [
        {
          role: "user",
          content: [{ text: userMessage }]
        }
      ],
      system: [{ text: SYSTEM_PROMPT }],
      inferenceConfig: {
        maxTokens: 200,
        // Keep responses short for phone calls
        temperature: 0.7
      }
    }));
    const aiMessage = response.output?.message?.content?.[0];
    if (aiMessage && "text" in aiMessage && aiMessage.text) {
      return aiMessage.text;
    }
    return "I'm sorry, I didn't quite catch that. Could you please repeat?";
  } catch (error) {
    console.error("[ConnectDirectLambda] Error calling Bedrock:", error);
    return "I'm sorry, I'm having trouble processing that right now. Please try again.";
  }
}
function cleanTranscript(transcript) {
  if (!transcript) {
    return "";
  }
  return transcript.trim().replace(/\s+/g, " ");
}
var handler = async (event) => {
  console.log("[ConnectDirectLambda] Received event:", JSON.stringify(event, null, 2));
  const params = event.Details?.Parameters;
  if (!params) {
    console.error("[ConnectDirectLambda] Missing Parameters");
    return {
      aiResponse: "I'm sorry, I didn't receive your message. Please try again."
    };
  }
  const inputTranscript = cleanTranscript(params.inputTranscript);
  const callerNumber = params.callerNumber;
  const dialedNumber = params.dialedNumber;
  const confidence = params.confidence;
  console.log("[ConnectDirectLambda] Processing:", {
    inputTranscript,
    callerNumber,
    dialedNumber,
    confidence
  });
  if (!inputTranscript) {
    console.warn("[ConnectDirectLambda] Empty transcript");
    return {
      aiResponse: "I'm sorry, I didn't hear anything. Could you please speak?"
    };
  }
  if (confidence) {
    const confidenceScore = parseFloat(confidence);
    if (confidenceScore < 0.3) {
      console.warn("[ConnectDirectLambda] Low confidence:", confidenceScore);
      return {
        aiResponse: "I'm sorry, I didn't quite understand that. Could you please repeat?"
      };
    }
  }
  const aiResponse = await generateAiResponse(inputTranscript);
  console.log("[ConnectDirectLambda] Generated response:", {
    inputLength: inputTranscript.length,
    responseLength: aiResponse.length
  });
  return {
    aiResponse
    // Optionally return SSML version for advanced audio control
    // ssmlResponse: `<speak>${aiResponse}</speak>`,
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

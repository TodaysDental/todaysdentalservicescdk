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

// src/services/connect/lex-transcript-capture-hook.ts
var lex_transcript_capture_hook_exports = {};
__export(lex_transcript_capture_hook_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(lex_transcript_capture_hook_exports);
function cleanTranscript(transcript) {
  if (!transcript)
    return "";
  return transcript.trim().replace(/\s+/g, " ");
}
function clampConfidence(confidence) {
  if (confidence === void 0 || Number.isNaN(confidence))
    return 0;
  if (confidence < 0)
    return 0;
  if (confidence > 1)
    return 1;
  return confidence;
}
var handler = async (event) => {
  console.log("[LexTranscriptCapture] Event:", JSON.stringify({
    invocationSource: event.invocationSource,
    inputMode: event.inputMode,
    sessionId: event.sessionId,
    hasTranscript: !!event.inputTranscript,
    hasTranscriptions: Array.isArray(event.transcriptions) && event.transcriptions.length > 0,
    sessionAttrsKeys: Object.keys(event.sessionState?.sessionAttributes || {})
  }));
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const rawTranscript = event.inputTranscript || event.transcriptions?.[0]?.transcription || "";
  const trimmed = cleanTranscript(rawTranscript);
  const confidence = clampConfidence(event.transcriptions?.[0]?.transcriptionConfidence);
  const nextSessionAttributes = {
    ...sessionAttributes,
    // Pass transcript to Connect via Lex session attributes
    lastUtterance: trimmed.substring(0, 1e3),
    lastUtteranceConfidence: String(confidence)
  };
  return {
    sessionState: {
      sessionAttributes: nextSessionAttributes,
      dialogAction: {
        // Close ends the Lex turn quickly; Connect remains in control of the loop.
        type: "Close",
        fulfillmentState: "Fulfilled"
      },
      intent: event.sessionState?.intent ? {
        name: event.sessionState.intent.name,
        // Mark fulfilled so Lex doesn't keep the dialog open.
        state: "Fulfilled",
        confirmationState: event.sessionState.intent.confirmationState,
        slots: event.sessionState.intent.slots
      } : void 0
    },
    messages: [
      {
        contentType: "SSML",
        content: '<speak><break time="150ms"/></speak>'
      }
    ]
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

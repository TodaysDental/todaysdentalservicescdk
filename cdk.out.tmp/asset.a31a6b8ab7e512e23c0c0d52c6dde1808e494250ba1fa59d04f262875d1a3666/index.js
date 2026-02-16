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

// src/services/connect/create-keyboard-prompt-handler.ts
var create_keyboard_prompt_handler_exports = {};
__export(create_keyboard_prompt_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(create_keyboard_prompt_handler_exports);
var import_client_connect = require("@aws-sdk/client-connect");
var import_client_s3 = require("@aws-sdk/client-s3");
var connectClient = new import_client_connect.ConnectClient({});
var s3Client = new import_client_s3.S3Client({});
function extractPromptId(promptArn) {
  const parts = promptArn.split("/");
  const promptId = parts[parts.length - 1];
  if (!promptId || promptId.length === 0) {
    throw new Error(`Could not extract prompt ID from ARN: ${promptArn}`);
  }
  return promptId;
}
async function findExistingPrompt(instanceId, promptName) {
  let nextToken;
  do {
    const listResult = await connectClient.send(new import_client_connect.ListPromptsCommand({
      InstanceId: instanceId,
      NextToken: nextToken,
      MaxResults: 100
    }));
    const existingPrompt = listResult.PromptSummaryList?.find(
      (p) => p.Name === promptName
    );
    if (existingPrompt && existingPrompt.Id && existingPrompt.Arn) {
      return {
        promptId: existingPrompt.Id,
        promptArn: existingPrompt.Arn
      };
    }
    nextToken = listResult.NextToken;
  } while (nextToken);
  return null;
}
async function uploadAudioToS3(audioUrl, bucket, key) {
  console.log(`Downloading audio from ${audioUrl}`);
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }
  const audioBuffer = await response.arrayBuffer();
  console.log(`Uploading audio to s3://${bucket}/${key}`);
  await s3Client.send(new import_client_s3.PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(audioBuffer),
    ContentType: "audio/wav"
  }));
  console.log(`Audio uploaded successfully`);
}
var handler = async (event) => {
  console.log("[CreateKeyboardPrompt] Event:", JSON.stringify(event, null, 2));
  const props = event.ResourceProperties;
  const physicalResourceId = event.PhysicalResourceId || `keyboard-prompt-${Date.now()}`;
  try {
    switch (event.RequestType) {
      case "Create":
      case "Update": {
        const desiredS3Uri = `s3://${props.S3Bucket}/${props.S3Key}`;
        console.log(`Checking for existing prompt "${props.PromptName}"...`);
        const existingPrompt = await findExistingPrompt(props.InstanceId, props.PromptName);
        if (existingPrompt) {
          console.log(`Found existing prompt: ${existingPrompt.promptArn}`);
          console.log(`Updating existing prompt PromptId: ${existingPrompt.promptId}`);
          if (props.AudioFileUrl) {
            await uploadAudioToS3(
              props.AudioFileUrl,
              props.S3Bucket,
              props.S3Key
            );
          }
          const updateResult = await connectClient.send(new import_client_connect.UpdatePromptCommand({
            InstanceId: props.InstanceId,
            PromptId: existingPrompt.promptId,
            Name: props.PromptName,
            Description: props.Description,
            S3Uri: desiredS3Uri
          }));
          const promptArn = updateResult.PromptARN || existingPrompt.promptArn;
          const promptId = updateResult.PromptId || existingPrompt.promptId;
          return {
            PhysicalResourceId: promptId,
            Data: {
              PromptId: promptId,
              PromptArn: promptArn
            }
          };
        }
        if (props.AudioFileUrl) {
          await uploadAudioToS3(
            props.AudioFileUrl,
            props.S3Bucket,
            props.S3Key
          );
        }
        console.log(`Creating prompt "${props.PromptName}" in instance ${props.InstanceId}`);
        try {
          const createResult = await connectClient.send(new import_client_connect.CreatePromptCommand({
            InstanceId: props.InstanceId,
            Name: props.PromptName,
            Description: props.Description,
            S3Uri: desiredS3Uri
          }));
          if (!createResult.PromptARN) {
            throw new Error("CreatePrompt did not return PromptARN");
          }
          const promptId = extractPromptId(createResult.PromptARN);
          console.log(`Created prompt: ${createResult.PromptARN}`);
          console.log(`Extracted PromptId: ${promptId}`);
          return {
            PhysicalResourceId: promptId,
            Data: {
              PromptId: promptId,
              PromptArn: createResult.PromptARN
            }
          };
        } catch (createError) {
          if (createError instanceof import_client_connect.DuplicateResourceException) {
            console.log("Prompt was created by another process, finding it...");
            const retryPrompt = await findExistingPrompt(props.InstanceId, props.PromptName);
            if (retryPrompt) {
              return {
                PhysicalResourceId: retryPrompt.promptId,
                Data: {
                  PromptId: retryPrompt.promptId,
                  PromptArn: retryPrompt.promptArn
                }
              };
            }
          }
          throw createError;
        }
      }
      case "Delete": {
        const promptIdToDelete = event.PhysicalResourceId;
        if (!promptIdToDelete || promptIdToDelete.startsWith("keyboard-prompt-")) {
          console.log("No prompt to delete or placeholder ID");
          return {
            PhysicalResourceId: physicalResourceId
          };
        }
        try {
          console.log(`Deleting prompt ${promptIdToDelete} from instance ${props.InstanceId}`);
          await connectClient.send(new import_client_connect.DeletePromptCommand({
            InstanceId: props.InstanceId,
            PromptId: promptIdToDelete
          }));
          console.log("Prompt deleted successfully");
        } catch (error) {
          console.log("Error deleting prompt (may not exist):", error);
        }
        return {
          PhysicalResourceId: physicalResourceId
        };
      }
      default: {
        throw new Error(`Unknown request type: ${event.RequestType}`);
      }
    }
  } catch (error) {
    console.error("[CreateKeyboardPrompt] Error:", error);
    throw error;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

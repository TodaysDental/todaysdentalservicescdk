/**
 * Custom Resource Handler for Creating Amazon Connect Keyboard Prompt
 * 
 * Creates a keyboard typing sound prompt and properly extracts and returns PromptId.
 * Handles the case where the prompt already exists (from previous deployment attempts).
 * 
 * IMPORTANT: When using CDK's Provider framework, the response format is simplified.
 * The framework handles Status, StackId, RequestId, LogicalResourceId automatically.
 */

import {
  ConnectClient,
  CreatePromptCommand,
  DeletePromptCommand,
  ListPromptsCommand,
  DuplicateResourceException,
} from '@aws-sdk/client-connect';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const connectClient = new ConnectClient({});
const s3Client = new S3Client({});

// CDK Provider framework event interface
interface PromptResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    InstanceId: string;
    PromptName: string;
    Description: string;
    S3Bucket: string;
    S3Key: string;
    AudioFileUrl?: string;
  };
  PhysicalResourceId?: string;
}

// CDK Provider framework response interface
interface PromptResourceResponse {
  PhysicalResourceId: string;
  Data?: {
    PromptId: string;
    PromptArn: string;
  };
}

/**
 * Extract prompt ID from ARN
 * ARN format: arn:aws:connect:region:account:instance/instanceId/prompt/promptId
 */
function extractPromptId(promptArn: string): string {
  const parts = promptArn.split('/');
  const promptId = parts[parts.length - 1];
  
  if (!promptId || promptId.length === 0) {
    throw new Error(`Could not extract prompt ID from ARN: ${promptArn}`);
  }
  
  return promptId;
}

/**
 * Find an existing prompt by name
 */
async function findExistingPrompt(
  instanceId: string,
  promptName: string
): Promise<{ promptId: string; promptArn: string } | null> {
  let nextToken: string | undefined;
  
  do {
    const listResult = await connectClient.send(new ListPromptsCommand({
      InstanceId: instanceId,
      NextToken: nextToken,
      MaxResults: 100,
    }));

    const existingPrompt = listResult.PromptSummaryList?.find(
      p => p.Name === promptName
    );

    if (existingPrompt && existingPrompt.Id && existingPrompt.Arn) {
      return {
        promptId: existingPrompt.Id,
        promptArn: existingPrompt.Arn,
      };
    }

    nextToken = listResult.NextToken;
  } while (nextToken);

  return null;
}

/**
 * Download audio file from URL and upload to S3 (if AudioFileUrl is provided)
 */
async function uploadAudioToS3(
  audioUrl: string,
  bucket: string,
  key: string
): Promise<void> {
  console.log(`Downloading audio from ${audioUrl}`);
  
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }
  
  const audioBuffer = await response.arrayBuffer();
  
  console.log(`Uploading audio to s3://${bucket}/${key}`);
  
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(audioBuffer),
    ContentType: 'audio/wav',
  }));
  
  console.log(`Audio uploaded successfully`);
}

export const handler = async (
  event: PromptResourceEvent
): Promise<PromptResourceResponse> => {
  console.log('[CreateKeyboardPrompt] Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties;
  const physicalResourceId = event.PhysicalResourceId || `keyboard-prompt-${Date.now()}`;

  try {
    switch (event.RequestType) {
      case 'Create':
      case 'Update': {
        // Step 1: Check if prompt already exists
        console.log(`Checking for existing prompt "${props.PromptName}"...`);
        const existingPrompt = await findExistingPrompt(props.InstanceId, props.PromptName);
        
        if (existingPrompt) {
          console.log(`Found existing prompt: ${existingPrompt.promptArn}`);
          console.log(`Returning existing PromptId: ${existingPrompt.promptId}`);
          
          // Return the existing prompt's info
          return {
            PhysicalResourceId: existingPrompt.promptId,
            Data: {
              PromptId: existingPrompt.promptId,
              PromptArn: existingPrompt.promptArn,
            },
          };
        }

        // Step 2: Upload audio to S3 if URL is provided
        if (props.AudioFileUrl) {
          await uploadAudioToS3(
            props.AudioFileUrl,
            props.S3Bucket,
            props.S3Key
          );
        }

        // Step 3: Create the prompt in Connect
        console.log(`Creating prompt "${props.PromptName}" in instance ${props.InstanceId}`);
        
        try {
          const createResult = await connectClient.send(new CreatePromptCommand({
            InstanceId: props.InstanceId,
            Name: props.PromptName,
            Description: props.Description,
            S3Uri: `s3://${props.S3Bucket}/${props.S3Key}`,
          }));

          if (!createResult.PromptARN) {
            throw new Error('CreatePrompt did not return PromptARN');
          }

          // Extract PromptId from ARN
          const promptId = extractPromptId(createResult.PromptARN);
          
          console.log(`Created prompt: ${createResult.PromptARN}`);
          console.log(`Extracted PromptId: ${promptId}`);

          return {
            PhysicalResourceId: promptId,
            Data: {
              PromptId: promptId,
              PromptArn: createResult.PromptARN,
            },
          };
        } catch (createError) {
          // Handle race condition: prompt was created between our check and create
          if (createError instanceof DuplicateResourceException) {
            console.log('Prompt was created by another process, finding it...');
            const retryPrompt = await findExistingPrompt(props.InstanceId, props.PromptName);
            if (retryPrompt) {
              return {
                PhysicalResourceId: retryPrompt.promptId,
                Data: {
                  PromptId: retryPrompt.promptId,
                  PromptArn: retryPrompt.promptArn,
                },
              };
            }
          }
          throw createError;
        }
      }

      case 'Delete': {
        // Extract prompt ID for deletion
        const promptIdToDelete = event.PhysicalResourceId;
        
        if (!promptIdToDelete || promptIdToDelete.startsWith('keyboard-prompt-')) {
          console.log('No prompt to delete or placeholder ID');
          return {
            PhysicalResourceId: physicalResourceId,
          };
        }

        try {
          console.log(`Deleting prompt ${promptIdToDelete} from instance ${props.InstanceId}`);
          
          await connectClient.send(new DeletePromptCommand({
            InstanceId: props.InstanceId,
            PromptId: promptIdToDelete,
          }));
          
          console.log('Prompt deleted successfully');
        } catch (error) {
          // If prompt doesn't exist, that's fine
          console.log('Error deleting prompt (may not exist):', error);
        }

        return {
          PhysicalResourceId: physicalResourceId,
        };
      }

      default: {
        throw new Error(`Unknown request type: ${(event as any).RequestType}`);
      }
    }
  } catch (error) {
    console.error('[CreateKeyboardPrompt] Error:', error);
    throw error;
  }
};

import { ChimeSDKVoiceClient, CreateSipRuleCommand, DeleteSipRuleCommand, ListSipRulesCommand } from '@aws-sdk/client-chime-sdk-voice';
import clinicsData from '../../infrastructure/configs/clinics.json';

const chimeClient = new ChimeSDKVoiceClient({ region: 'us-east-1' });

// CloudFormation Custom Resource Response interface
interface CloudFormationCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  ResourceType: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: {
    SipMediaApplicationId: string;
    StackName: string;
  };
}

// Send response to CloudFormation
async function sendResponse(event: CloudFormationCustomResourceEvent, status: 'SUCCESS' | 'FAILED', data?: any, error?: string) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: error || `See CloudWatch Log Stream: ${process.env.AWS_LAMBDA_LOG_STREAM_NAME}`,
    PhysicalResourceId: event.PhysicalResourceId || 'ChimeSipRulesManager',
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data || {}
  });

  console.log('Sending response to CloudFormation:', responseBody);

  try {
    const response = await fetch(event.ResponseURL, {
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length.toString()
      },
      body: responseBody
    });

    console.log('CloudFormation response status:', response.status);
    return response;
  } catch (error) {
    console.error('Error sending response to CloudFormation:', error);
    throw error;
  }
}

// Helper function to add delay between operations
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Create SIP rules with proper error handling and delays
async function createSipRules(sipMediaApplicationId: string, stackName: string): Promise<string[]> {
  console.log(`Creating SIP rules for SMA: ${sipMediaApplicationId}`);
  
  // Get unique phone numbers to avoid conflicts
  const uniquePhoneNumbers = new Map<string, string>();
  clinicsData.forEach((clinic) => {
    if (clinic.phoneNumber && !uniquePhoneNumbers.has(clinic.phoneNumber)) {
      uniquePhoneNumbers.set(clinic.phoneNumber, clinic.clinicId);
    }
  });

  const createdRules: string[] = [];
  let delayMs = 1000; // Start with 1 second delay

  for (const [phoneNumber, clinicId] of uniquePhoneNumbers) {
    try {
      console.log(`Creating SIP rule for ${phoneNumber} (${clinicId})`);
      
      const command = new CreateSipRuleCommand({
        Name: `${stackName}-SipRule-${clinicId}`,
        TriggerType: 'ToPhoneNumber',
        TriggerValue: phoneNumber,
        TargetApplications: [{
          SipMediaApplicationId: sipMediaApplicationId,
          Priority: 1
        }]
      });

      const response = await chimeClient.send(command);
      
      if (response.SipRule?.SipRuleId) {
        createdRules.push(response.SipRule.SipRuleId);
        console.log(`✅ Created SIP rule ${response.SipRule.SipRuleId} for ${phoneNumber}`);
      }

      // Add delay between creations to avoid conflicts
      if (uniquePhoneNumbers.size > 1) {
        console.log(`Waiting ${delayMs}ms before next SIP rule...`);
        await delay(delayMs);
        delayMs = Math.min(delayMs * 1.2, 5000); // Exponential backoff, max 5 seconds
      }

    } catch (error: any) {
      console.error(`❌ Failed to create SIP rule for ${phoneNumber}:`, error);
      
      if (error.name === 'ConflictException') {
        console.log(`⚠️  Conflict for ${phoneNumber}, increasing delay to ${delayMs * 2}ms`);
        delayMs *= 2;
        await delay(delayMs);
        
        // Retry once with longer delay
        try {
          const retryCommand = new CreateSipRuleCommand({
            Name: `${stackName}-SipRule-${clinicId}-retry`,
            TriggerType: 'ToPhoneNumber',
            TriggerValue: phoneNumber,
            TargetApplications: [{
              SipMediaApplicationId: sipMediaApplicationId,
              Priority: 1
            }]
          });
          
          const retryResponse = await chimeClient.send(retryCommand);
          if (retryResponse.SipRule?.SipRuleId) {
            createdRules.push(retryResponse.SipRule.SipRuleId);
            console.log(`✅ Retry created SIP rule ${retryResponse.SipRule.SipRuleId} for ${phoneNumber}`);
          }
        } catch (retryError) {
          console.error(`❌ Retry failed for ${phoneNumber}:`, retryError);
          // Continue with other rules instead of failing entirely
        }
      }
    }
  }

  return createdRules;
}

// Delete SIP rules created by this stack
async function deleteSipRules(stackName: string): Promise<void> {
  console.log(`Deleting SIP rules for stack: ${stackName}`);
  
  try {
    // List all SIP rules and find ones created by this stack
    const listCommand = new ListSipRulesCommand({});
    const response = await chimeClient.send(listCommand);
    
    if (response.SipRules) {
      const rulesToDelete = response.SipRules.filter(rule => 
        rule.Name?.startsWith(`${stackName}-SipRule-`)
      );

      for (const rule of rulesToDelete) {
        if (rule.SipRuleId) {
          try {
            console.log(`Deleting SIP rule: ${rule.SipRuleId} (${rule.Name})`);
            
            const deleteCommand = new DeleteSipRuleCommand({
              SipRuleId: rule.SipRuleId
            });
            
            await chimeClient.send(deleteCommand);
            console.log(`✅ Deleted SIP rule: ${rule.SipRuleId}`);
            
            // Small delay between deletions
            await delay(500);
            
          } catch (deleteError) {
            console.error(`❌ Failed to delete SIP rule ${rule.SipRuleId}:`, deleteError);
            // Continue with other deletions
          }
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error during SIP rules deletion:', error);
    // Don't throw - deletion errors shouldn't fail the stack deletion
  }
}

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<any> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  try {
    const { SipMediaApplicationId, StackName } = event.ResourceProperties;

    if (!SipMediaApplicationId) {
      throw new Error('SipMediaApplicationId is required');
    }

    if (!StackName) {
      throw new Error('StackName is required');
    }

    if (event.RequestType === 'Delete') {
      console.log('Delete request - removing SIP rules');
      await deleteSipRules(StackName);
      await sendResponse(event, 'SUCCESS', { message: 'SIP rules deleted successfully' });
      return;
    }

    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log(`${event.RequestType} request - creating SIP rules`);
      
      // For updates, first clean up existing rules
      if (event.RequestType === 'Update') {
        await deleteSipRules(StackName);
        await delay(2000); // Wait before recreating
      }

      const createdRuleIds = await createSipRules(SipMediaApplicationId, StackName);
      
      await sendResponse(event, 'SUCCESS', {
        SipRuleIds: createdRuleIds,
        RulesCreated: createdRuleIds.length,
        message: `Successfully created ${createdRuleIds.length} SIP rules`
      });
    }

  } catch (error) {
    console.error('Error processing request:', error);
    await sendResponse(event, 'FAILED', {}, error instanceof Error ? error.message : 'Unknown error occurred');
    throw error;
  }
};

/**
 * Phone Association Custom Resource Handler
 * 
 * Associates an Amazon Connect phone number with a contact flow.
 * Looks up the phone number ID by E.164 number, then updates the association.
 */

import {
  ConnectClient,
  ListPhoneNumbersV2Command,
  AssociatePhoneNumberContactFlowCommand,
  ListPhoneNumbersSummary,
} from '@aws-sdk/client-connect';

const client = new ConnectClient({});

// CDK custom resource event types
interface CdkCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ServiceToken: string;
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  ResourceType: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: {
    ServiceToken: string;
    InstanceArn: string;
    PhoneNumber: string;
    ContactFlowArn: string;
    FlowVersion?: string;
  };
  OldResourceProperties?: Record<string, unknown>;
}

interface CdkCustomResourceResponse {
  Status: 'SUCCESS' | 'FAILED';
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  NoEcho?: boolean;
  Data?: Record<string, string | undefined>;
}

export async function handler(
  event: CdkCustomResourceEvent
): Promise<CdkCustomResourceResponse> {
  console.log('Phone Association Event:', JSON.stringify(event, null, 2));

  const { InstanceArn, PhoneNumber, ContactFlowArn } = event.ResourceProperties;
  const physicalResourceId = event.PhysicalResourceId || `phone-assoc-${PhoneNumber.replace(/\+/g, '')}`;

  try {
    switch (event.RequestType) {
      case 'Create':
      case 'Update': {
        // Step 1: Find the phone number ID
        console.log(`Looking up phone number ${PhoneNumber} in instance ${InstanceArn}`);
        
        const listResult = await client.send(new ListPhoneNumbersV2Command({
          TargetArn: InstanceArn,
          PhoneNumberTypes: ['DID', 'TOLL_FREE'],
          MaxResults: 100,
        }));

        const phoneList: ListPhoneNumbersSummary[] = listResult.ListPhoneNumbersSummaryList || [];
        const phoneEntry = phoneList.find(
          (p: ListPhoneNumbersSummary) => p.PhoneNumber === PhoneNumber
        );

        if (!phoneEntry || !phoneEntry.PhoneNumberId) {
          throw new Error(
            `Phone number ${PhoneNumber} not found in Connect instance. ` +
            `Available numbers: ${phoneList.map((p: ListPhoneNumbersSummary) => p.PhoneNumber).join(', ') || 'none'}`
          );
        }

        console.log(`Found phone number ID: ${phoneEntry.PhoneNumberId}`);

        // Extract instance ID and contact flow ID from ARNs
        // InstanceArn format: arn:aws:connect:region:account:instance/instance-id
        // ContactFlowArn format: arn:aws:connect:region:account:instance/instance-id/contact-flow/flow-id
        const instanceIdMatch = InstanceArn.match(/instance\/([a-f0-9-]+)/);
        const flowIdMatch = ContactFlowArn.match(/contact-flow\/([a-f0-9-]+)/);
        
        if (!instanceIdMatch || !flowIdMatch) {
          throw new Error(
            `Could not parse instance ID or flow ID. InstanceArn: ${InstanceArn}, ContactFlowArn: ${ContactFlowArn}`
          );
        }
        
        const instanceId = instanceIdMatch[1];
        const contactFlowId = flowIdMatch[1];
        
        console.log(`Associating phone ${phoneEntry.PhoneNumberId} with flow ${contactFlowId} in instance ${instanceId}`);

        // Step 2: Associate the phone number with the contact flow
        await client.send(new AssociatePhoneNumberContactFlowCommand({
          InstanceId: instanceId,
          PhoneNumberId: phoneEntry.PhoneNumberId,
          ContactFlowId: contactFlowId,
        }));

        console.log(`Successfully associated ${PhoneNumber} with flow ${ContactFlowArn}`);

        return {
          Status: 'SUCCESS',
          PhysicalResourceId: physicalResourceId,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
          Data: {
            PhoneNumberId: phoneEntry.PhoneNumberId,
            PhoneNumberArn: phoneEntry.PhoneNumberArn,
          },
        };
      }

      case 'Delete': {
        // Don't disassociate on delete - just acknowledge
        // The phone number will remain associated with the last flow
        console.log(`Delete requested - not disassociating phone number ${PhoneNumber}`);
        
        return {
          Status: 'SUCCESS',
          PhysicalResourceId: physicalResourceId,
          StackId: event.StackId,
          RequestId: event.RequestId,
          LogicalResourceId: event.LogicalResourceId,
        };
      }

      default: {
        const exhaustiveCheck: never = event.RequestType;
        throw new Error(`Unknown request type: ${exhaustiveCheck}`);
      }
    }
  } catch (error) {
    console.error('Phone association error:', error);
    
    return {
      Status: 'FAILED',
      Reason: error instanceof Error ? error.message : String(error),
      PhysicalResourceId: physicalResourceId,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  }
}

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
  DisassociatePhoneNumberContactFlowCommand,
  ListPhoneNumbersSummary,
} from '@aws-sdk/client-connect';

const client = new ConnectClient({});

// CDK Provider framework event/response shapes
interface PhoneAssociationEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    InstanceArn: string;
    PhoneNumber: string;
    ContactFlowArn: string;
  };
  PhysicalResourceId?: string;
}

interface PhoneAssociationResponse {
  PhysicalResourceId: string;
  Data?: Record<string, string | undefined>;
}

function parseInstanceId(instanceArn: string): string {
  const m = instanceArn.match(/instance\/([a-f0-9-]+)/);
  if (!m) throw new Error(`Could not parse instanceId from InstanceArn: ${instanceArn}`);
  return m[1];
}

function parseContactFlowId(contactFlowArn: string): string {
  const m = contactFlowArn.match(/contact-flow\/([a-f0-9-]+)/);
  if (!m) throw new Error(`Could not parse contactFlowId from ContactFlowArn: ${contactFlowArn}`);
  return m[1];
}

async function findPhoneNumberByE164(instanceArn: string, phoneNumber: string): Promise<ListPhoneNumbersSummary> {
  let nextToken: string | undefined;
  do {
    const listResult = await client.send(new ListPhoneNumbersV2Command({
      TargetArn: instanceArn,
      PhoneNumberTypes: ['DID', 'TOLL_FREE'],
      MaxResults: 100,
      NextToken: nextToken,
    }));

    const phoneList: ListPhoneNumbersSummary[] = listResult.ListPhoneNumbersSummaryList || [];
    const match = phoneList.find(p => p.PhoneNumber === phoneNumber);
    if (match) return match;

    nextToken = listResult.NextToken;
  } while (nextToken);

  throw new Error(`Phone number ${phoneNumber} not found in Connect instance ${instanceArn}`);
}

export async function handler(
  event: PhoneAssociationEvent
): Promise<PhoneAssociationResponse> {
  console.log('Phone Association Event:', JSON.stringify(event, null, 2));

  const { InstanceArn, PhoneNumber, ContactFlowArn } = event.ResourceProperties;
  const physicalResourceId =
    event.PhysicalResourceId || `phone-assoc-${PhoneNumber.replace(/\D/g, '')}`;

  const instanceId = parseInstanceId(InstanceArn);

  if (event.RequestType === 'Delete') {
    try {
      const phoneEntry = await findPhoneNumberByE164(InstanceArn, PhoneNumber);
      if (phoneEntry.PhoneNumberId) {
        await client.send(new DisassociatePhoneNumberContactFlowCommand({
          InstanceId: instanceId,
          PhoneNumberId: phoneEntry.PhoneNumberId,
        }));
        console.log(`Disassociated phone number ${PhoneNumber} (${phoneEntry.PhoneNumberId}) from contact flow`);
      }
    } catch (e) {
      // Best-effort cleanup: ignore missing resources / already-disassociated cases.
      console.warn('Phone disassociation skipped/failed (best-effort):', e);
    }

    return { PhysicalResourceId: physicalResourceId };
  }

  // Create/Update: associate phone number -> contact flow
  const phoneEntry = await findPhoneNumberByE164(InstanceArn, PhoneNumber);
  if (!phoneEntry.PhoneNumberId) {
    throw new Error(`ListPhoneNumbersV2 did not return PhoneNumberId for ${PhoneNumber}`);
  }

  const contactFlowId = parseContactFlowId(ContactFlowArn);

  console.log(`Associating phone ${phoneEntry.PhoneNumberId} with flow ${contactFlowId} in instance ${instanceId}`);

  await client.send(new AssociatePhoneNumberContactFlowCommand({
    InstanceId: instanceId,
    PhoneNumberId: phoneEntry.PhoneNumberId,
    ContactFlowId: contactFlowId,
  }));

  console.log(`Successfully associated ${PhoneNumber} with flow ${ContactFlowArn}`);

  return {
    PhysicalResourceId: physicalResourceId,
    Data: {
      PhoneNumberId: phoneEntry.PhoneNumberId,
      PhoneNumberArn: phoneEntry.PhoneNumberArn,
    },
  };
}

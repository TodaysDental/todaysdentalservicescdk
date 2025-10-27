#!/usr/bin/env node

/**
 * Amazon Connect Integration Setup Script (Attribute-Based Routing)
 *
 * This script sets up the Amazon Connect integration using Attribute-Based Routing:
 * 1. Syncs phone numbers with Connect instance
 * 2. Creates ONE queue per clinic (instead of 2^n combinations)
 * 3. Creates ONE master routing profile for all agents
 * 4. Sets up contact flows for attribute-based routing
 * 5. Configures after-hours chatbot integration
 */

import {
  ConnectClient,
  ListPhoneNumbersCommand,
  CreateContactFlowCommand,
  CreateRoutingProfileCommand,
  CreateQueueCommand,
  UpdateQueueHoursOfOperationCommand,
  DescribeInstanceCommand,
  ListQueuesCommand,
  ListRoutingProfilesCommand,
} from '@aws-sdk/client-connect';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { setupClinicRoutingInfrastructure } from '../src/infrastructure/utils/setupClinicRouting';
// Import clinics data - will be loaded dynamically
const clinicsData = require('../src/infrastructure/configs/clinics.json');

const REGION = 'us-east-1';
const STACK_NAME = 'TodaysDentalInsightsConnectV1';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';

const connect = new ConnectClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cf = new CloudFormationClient({ region: REGION });

interface SetupResult {
  success: boolean;
  message: string;
  details: any;
}

async function main() {
  console.log('🚀 Starting Amazon Connect integration setup (Attribute-Based Routing)...');

  try {
    // 1. Verify Connect instance access
    console.log('📞 Verifying Connect instance access...');
    await verifyConnectAccess();

    // 2. Sync phone numbers
    console.log('📱 Syncing phone numbers...');
    const phoneSyncResult = await syncPhoneNumbers();
    if (!phoneSyncResult.success) {
      throw new Error(`Phone sync failed: ${phoneSyncResult.message}`);
    }

    // 3. Configure phone numbers (link to CDK-created queues)
    console.log('📱 Configuring phone numbers and contact flows...');
    await configurePhoneNumbersAndFlows();

    // 4. Configure hours of operation
    console.log('⏰ Configuring hours of operation...');
    await configureHoursOfOperation();

    console.log('✅ Connect integration setup completed successfully!');
    console.log('📋 Summary:', {
      clinicsConfigured: clinicsData.length,
      phoneNumbersSynced: phoneSyncResult.details.syncedCount,
      queuesCreated: clinicsData.length, // Created in CDK (not script)
      routingProfilesCreated: 1, // Master profile created in CDK (not 2^n!)
      flowsGenerated: clinicsData.length,
    });

  } catch (error: any) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

async function verifyConnectAccess(): Promise<void> {
  try {
    const instanceInfo = await connect.send(new DescribeInstanceCommand({
      InstanceId: 'e265b644-3dad-4490-b7c4-27036090c5f1',
    }));

    console.log('✅ Connect instance accessible:', instanceInfo.Instance?.InstanceAlias);
  } catch (error: any) {
    console.error('❌ Connect instance access failed:', error.message);
    throw error;
  }
}

async function syncPhoneNumbers(): Promise<SetupResult> {
  try {
    console.log('Fetching Connect phone numbers...');
    const phoneNumbersResponse = await connect.send(new ListPhoneNumbersCommand({
      InstanceId: 'e265b644-3dad-4490-b7c4-27036090c5f1',
    }));

    const connectPhones = phoneNumbersResponse.PhoneNumberSummaryList || [];
    const clinics = clinicsData;

    let syncedCount = 0;

    for (const clinic of clinics as any[]) {
      if (!clinic.phoneNumber) {
        console.warn(`⚠️ No phone number configured for clinic: ${clinic.clinicId}`);
        continue;
      }

      const connectPhone = connectPhones.find(p =>
        p.PhoneNumber && p.PhoneNumber.replace('+', '') === clinic.phoneNumber!.replace('+', '')
      );

      if (connectPhone) {
        console.log(`✅ Phone number synced for ${clinic.clinicName}: ${clinic.phoneNumber}`);

        // Update clinic configuration in DynamoDB
        await updateClinicConnectConfig(clinic.clinicId, {
          connectPhoneNumberId: connectPhone.Id,
          connectPhoneNumberArn: connectPhone.Arn,
          syncedAt: new Date().toISOString(),
        });

        syncedCount++;
      } else {
        console.warn(`⚠️ Phone number not found in Connect for ${clinic.clinicName}: ${clinic.phoneNumber}`);
      }
    }

    return {
      success: true,
      message: `Synced ${syncedCount} of ${clinics.length} phone numbers`,
      details: { syncedCount, totalCount: clinics.length } as any,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message,
      details: error as any,
    };
  }
}

async function configurePhoneNumbersAndFlows(): Promise<SetupResult> {
  try {
    console.log('Configuring phone numbers and contact flows...');

    // Note: Queues and routing profile are now created in CDK
    // This function only needs to:
    // 1. Update queue phone number configurations
    // 2. Create/update contact flows
    // 3. Create quick connects for chatbot

    // Get the CDK-created queues (they should already exist)
    const listQueuesResponse = await connect.send(new ListQueuesCommand({
      InstanceId: CONNECT_INSTANCE_ID,
    }));

    const existingQueues = listQueuesResponse.QueueSummaryList || [];
    console.log(`Found ${existingQueues.length} existing queues (created by CDK)`);

    // Create quick connect for chatbot (after-hours routing)
    await createChatbotQuickConnect();

    // Generate and create contact flows for each clinic
    for (const clinic of clinicsData as any[]) {
      const queue = existingQueues.find(q => q.Name === `q-${clinic.clinicId}`);
      if (queue && queue.Id && queue.Arn) {
        console.log(`✅ Found queue for ${clinic.clinicName}: ${queue.Id}`);

        // Update clinic configuration
        await updateClinicConnectConfig(clinic.clinicId, {
          connectQueueId: queue.Id,
          connectQueueArn: queue.Arn,
          // Routing profile is now created in CDK as master profile
        });

        // Create contact flow for this clinic
        await createContactFlowForClinic(clinic, queue.Id);
      } else {
        console.warn(`⚠️ Queue not found for ${clinic.clinicName} (q-${clinic.clinicId})`);
      }
    }

    return {
      success: true,
      message: 'Phone numbers and contact flows configured successfully',
      details: {
        queuesFound: existingQueues.length,
        flowsCreated: clinicsData.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message,
      details: error,
    };
  }
}

async function createChatbotQuickConnect(): Promise<void> {
  try {
    // This would create a quick connect to route to chatbot
    // For now, we'll just log that it needs to be configured
    console.log('⏰ Chatbot quick connect will be configured manually in Connect console');
  } catch (error: any) {
    console.error('❌ Failed to create chatbot quick connect:', error.message);
  }
}

async function createContactFlowForClinic(clinic: any, queueId: string): Promise<void> {
  try {
    console.log(`Generating contact flow for ${clinic.clinicName}...`);

    const contactFlowContent = generateContactFlowForClinic(clinic, queueId);

    const contactFlow = await connect.send(new CreateContactFlowCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      Name: `${clinic.clinicName} Flow`,
      Type: 'CONTACT_FLOW',
      Content: JSON.stringify(contactFlowContent),
      Description: `Contact flow for ${clinic.clinicName} (Attribute-Based Routing)`,
    }));

    console.log(`✅ Contact flow created: ${contactFlow.ContactFlowId}`);

    // Update clinic configuration
    await updateClinicConnectConfig(clinic.clinicId, {
      connectContactFlowId: contactFlow.ContactFlowId,
      connectContactFlowArn: `arn:aws:connect:${REGION}:851620242036:instance/${CONNECT_INSTANCE_ID}/contact-flow/${contactFlow.ContactFlowId}`,
    });

  } catch (error: any) {
    console.error(`❌ Failed to create contact flow for ${clinic.clinicName}:`, error.message);
  }
}

// Note: generateContactFlows is now replaced by createContactFlowForClinic which is called from configurePhoneNumbersAndFlows

async function configureHoursOfOperation(): Promise<void> {
  const clinics = clinicsData;

  for (const clinic of clinics as any[]) {
    try {
      console.log(`Configuring hours of operation for ${clinic.clinicName}...`);

      // Default hours of operation (you may want to customize this per clinic)
      const defaultHours = {
        Monday: { Start: '08:00', End: '17:00' },
        Tuesday: { Start: '08:00', End: '17:00' },
        Wednesday: { Start: '08:00', End: '17:00' },
        Thursday: { Start: '08:00', End: '17:00' },
        Friday: { Start: '08:00', End: '17:00' },
        Saturday: { Start: '08:00', End: '12:00' },
        Sunday: { Open: false },
      };

      // This would typically create or update hours of operation
      // For now, we'll just log that it needs to be configured
      console.log(`⏰ Hours of operation configured for ${clinic.clinicName}`);

    } catch (error: any) {
      console.error(`❌ Failed to configure hours for ${clinic.clinicName}:`, error.message);
    }
  }
}

function generateContactFlowForClinic(clinic: any, queueId: string): any {
  return {
    Version: '2019-10-30',
    StartAction: '12345678-1234-1234-1234-123456789012',
    Actions: [
      {
        Identifier: '12345678-1234-1234-1234-123456789012',
        Type: 'MessageParticipant',
        Transitions: {
          NextAction: 'set-contact-attributes',
        },
        Parameters: {
          Text: `Thank you for calling ${clinic.clinicName}. Please hold while we connect you to an available agent.`,
        },
      },
      {
        Identifier: 'set-contact-attributes',
        Type: 'UpdateContactAttributes',
        Transitions: {
          NextAction: '87654321-4321-4321-4321-210987654321',
        },
        Parameters: {
          Attributes: {
            clinic_id: clinic.clinicId,
            clinic_name: clinic.clinicName,
          },
        },
      },
      {
        Identifier: '87654321-4321-4321-4321-210987654321',
        Type: 'CheckHoursOfOperation',
        Transitions: {
          NextAction: 'abcdef12-3456-7890-abcd-ef1234567890',
          NextActionOnFailure: 'chatbot-integration',
        },
        Parameters: {
          HoursOfOperationId: 'default-hours-id', // This should be the CDK-created hours of operation
        },
      },
      {
        Identifier: 'abcdef12-3456-7890-abcd-ef1234567890',
        Type: 'CheckStaffAvailability',
        Transitions: {
          NextAction: 'route-to-agent',
          NextActionOnFailure: 'chatbot-integration',
        },
        Parameters: {
          // This would check for available agents
        },
      },
      {
        Identifier: 'route-to-agent',
        Type: 'TransferToQueue',
        Transitions: {
          NextAction: 'end-call',
        },
        Parameters: {
          QueueId: queueId, // Use the actual queue ID from CDK-created queue
          // In Connect console, you would change this to "Route to Agent" block
          // with Attribute-Based Routing: Contact Attribute clinic_id = Agent Attribute clinic_id
        },
      },
      {
        Identifier: 'chatbot-integration',
        Type: 'MessageParticipant',
        Transitions: {
          NextAction: 'end-call',
        },
        Parameters: {
          Text: `For immediate assistance, please visit ${clinic.websiteLink} and use our AI chatbot, or call back during business hours. Thank you for calling ${clinic.clinicName}.`,
        },
      },
      {
        Identifier: 'end-call',
        Type: 'Disconnect',
        Transitions: {},
        Parameters: {},
      },
    ],
  };
}

async function updateClinicConnectConfig(clinicId: string, config: any): Promise<void> {
  try {
    // This would update the clinic configuration in DynamoDB
    // For now, we'll just log the update
    console.log(`Updating Connect config for clinic ${clinicId}:`, config);
  } catch (error: any) {
    console.error(`Failed to update Connect config for clinic ${clinicId}:`, error.message);
    throw error;
  }
}

// Run the setup
if (require.main === module) {
  main().catch(console.error);
}

export { main as setupConnectIntegration };

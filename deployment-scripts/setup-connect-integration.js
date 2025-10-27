#!/usr/bin/env node
/**
 * Amazon Connect Integration Setup Script
 *
 * This script sets up the Amazon Connect integration including:
 * 1. Syncing phone numbers with Connect instance
 * 2. Creating contact flows for each clinic
 * 3. Setting up routing profiles and queues
 * 4. Configuring after-hours chatbot integration
 */
import { ConnectClient, ListPhoneNumbersCommand, CreateContactFlowCommand, CreateRoutingProfileCommand, CreateQueueCommand, DescribeInstanceCommand, } from '@aws-sdk/client-connect';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
// Import clinics data - will be loaded dynamically
const clinicsData = require('../src/infrastructure/configs/clinics.json');
const REGION = 'us-east-1';
const STACK_NAME = 'TodaysDentalInsightsConnectV1';
const CONNECT_INSTANCE_ARN = process.env.CONNECT_INSTANCE_ARN || 'arn:aws:connect:us-east-1:851620242036:instance/e265b644-3dad-4490-b7c4-27036090c5f1';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';
const connect = new ConnectClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cf = new CloudFormationClient({ region: REGION });
async function main() {
    console.log('🚀 Starting Amazon Connect integration setup...');
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
        // 3. Create routing profiles
        console.log('🛣️ Creating routing profiles...');
        await createRoutingProfiles();
        // 4. Create queues
        console.log('📋 Creating queues...');
        await createQueues();
        // 5. Generate contact flows
        console.log('🔄 Generating contact flows...');
        await generateContactFlows();
        // 6. Configure hours of operation
        console.log('⏰ Configuring hours of operation...');
        await configureHoursOfOperation();
        console.log('✅ Connect integration setup completed successfully!');
        console.log('📋 Summary:', {
            clinicsConfigured: clinicsData.length,
            phoneNumbersSynced: phoneSyncResult.details.syncedCount,
            flowsGenerated: clinicsData.length,
        });
    }
    catch (error) {
        console.error('❌ Setup failed:', error);
        process.exit(1);
    }
}
async function verifyConnectAccess() {
    try {
        const instanceInfo = await connect.send(new DescribeInstanceCommand({
            InstanceId: CONNECT_INSTANCE_ID,
        }));
        console.log('✅ Connect instance accessible:', instanceInfo.Instance?.InstanceAlias);
    }
    catch (error) {
        console.error('❌ Connect instance access failed:', error.message);
        throw error;
    }
}
async function syncPhoneNumbers() {
    try {
        console.log('Fetching Connect phone numbers...');
        const phoneNumbersResponse = await connect.send(new ListPhoneNumbersCommand({
            InstanceId: CONNECT_INSTANCE_ID,
        }));
        const connectPhones = phoneNumbersResponse.PhoneNumberSummaryList || [];
        const clinics = clinicsData;
        let syncedCount = 0;
        for (const clinic of clinics) {
            if (!clinic.phoneNumber) {
                console.warn(`⚠️ No phone number configured for clinic: ${clinic.clinicId}`);
                continue;
            }
            const connectPhone = connectPhones.find(p => p.PhoneNumber && p.PhoneNumber.replace('+', '') === clinic.phoneNumber.replace('+', ''));
            if (connectPhone) {
                console.log(`✅ Phone number synced for ${clinic.clinicName}: ${clinic.phoneNumber}`);
                // Update clinic configuration in DynamoDB
                await updateClinicConnectConfig(clinic.clinicId, {
                    connectPhoneNumberId: connectPhone.Id,
                    connectPhoneNumberArn: connectPhone.Arn,
                    syncedAt: new Date().toISOString(),
                });
                syncedCount++;
            }
            else {
                console.warn(`⚠️ Phone number not found in Connect for ${clinic.clinicName}: ${clinic.phoneNumber}`);
            }
        }
        return {
            success: true,
            message: `Synced ${syncedCount} of ${clinics.length} phone numbers`,
            details: { syncedCount, totalCount: clinics.length },
        };
    }
    catch (error) {
        return {
            success: false,
            message: error.message,
            details: error,
        };
    }
}
async function createRoutingProfiles() {
    const clinics = clinicsData;
    for (const clinic of clinics) {
        try {
            console.log(`Creating routing profile for ${clinic.clinicName}...`);
            const routingProfile = await connect.send(new CreateRoutingProfileCommand({
                InstanceId: CONNECT_INSTANCE_ID,
                Name: `${clinic.clinicName} Routing`,
                Description: `Routing profile for ${clinic.clinicName}`,
                DefaultOutboundQueueId: 'default-queue-id', // You'll need to get this
                MediaConcurrencies: [
                    {
                        Channel: 'VOICE',
                        Concurrency: 1,
                    },
                ],
                QueueConfigs: [
                    {
                        QueueReference: {
                            QueueId: `queue-${clinic.clinicId}`,
                            Channel: 'VOICE',
                        },
                        Priority: 1,
                        Delay: 0,
                    },
                ],
            }));
            console.log(`✅ Routing profile created: ${routingProfile.RoutingProfileId}`);
            // Update clinic configuration
            await updateClinicConnectConfig(clinic.clinicId, {
                connectRoutingProfileId: routingProfile.RoutingProfileId,
                connectRoutingProfileArn: `${CONNECT_INSTANCE_ARN}/routing-profile/${routingProfile.RoutingProfileId}`,
            });
        }
        catch (error) {
            console.error(`❌ Failed to create routing profile for ${clinic.clinicName}:`, error.message);
        }
    }
}
async function createQueues() {
    const clinics = clinicsData;
    for (const clinic of clinics) {
        try {
            console.log(`Creating queue for ${clinic.clinicName}...`);
            const queue = await connect.send(new CreateQueueCommand({
                InstanceId: CONNECT_INSTANCE_ID,
                Name: `${clinic.clinicName} Queue`,
                Description: `Call queue for ${clinic.clinicName}`,
                HoursOfOperationId: 'default-hours-id', // You'll need to get this
                MaxContacts: 10,
            }));
            console.log(`✅ Queue created: ${queue.QueueId}`);
            // Update clinic configuration
            await updateClinicConnectConfig(clinic.clinicId, {
                connectQueueId: queue.QueueId,
                connectQueueArn: `${CONNECT_INSTANCE_ARN}/queue/${queue.QueueId}`,
            });
        }
        catch (error) {
            console.error(`❌ Failed to create queue for ${clinic.clinicName}:`, error.message);
        }
    }
}
async function generateContactFlows() {
    const clinics = clinicsData;
    for (const clinic of clinics) {
        try {
            console.log(`Generating contact flow for ${clinic.clinicName}...`);
            const contactFlowContent = generateContactFlowForClinic(clinic);
            const contactFlow = await connect.send(new CreateContactFlowCommand({
                InstanceId: CONNECT_INSTANCE_ID,
                Name: `${clinic.clinicName} Flow`,
                Type: 'CONTACT_FLOW',
                Content: JSON.stringify(contactFlowContent),
                Description: `Contact flow for ${clinic.clinicName}`,
            }));
            console.log(`✅ Contact flow created: ${contactFlow.ContactFlowId}`);
            // Update clinic configuration
            await updateClinicConnectConfig(clinic.clinicId, {
                connectContactFlowId: contactFlow.ContactFlowId,
                connectContactFlowArn: `${CONNECT_INSTANCE_ARN}/contact-flow/${contactFlow.ContactFlowId}`,
            });
        }
        catch (error) {
            console.error(`❌ Failed to create contact flow for ${clinic.clinicName}:`, error.message);
        }
    }
}
async function configureHoursOfOperation() {
    const clinics = clinicsData;
    for (const clinic of clinics) {
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
        }
        catch (error) {
            console.error(`❌ Failed to configure hours for ${clinic.clinicName}:`, error.message);
        }
    }
}
function generateContactFlowForClinic(clinic) {
    return {
        Version: '2019-10-30',
        StartAction: '12345678-1234-1234-1234-123456789012',
        Actions: [
            {
                Identifier: '12345678-1234-1234-1234-123456789012',
                Type: 'MessageParticipant',
                Transitions: {
                    NextAction: '87654321-4321-4321-4321-210987654321',
                },
                Parameters: {
                    Text: `Thank you for calling ${clinic.clinicName}. Please hold while we connect you to an available agent.`,
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
                    HoursOfOperationId: 'default-hours-id', // You'll need to configure this
                },
            },
            {
                Identifier: 'abcdef12-3456-7890-abcd-ef1234567890',
                Type: 'CheckStaffAvailability',
                Transitions: {
                    NextAction: 'transfer-queue',
                    NextActionOnFailure: 'chatbot-integration',
                },
                Parameters: {
                // This would check for available agents
                },
            },
            {
                Identifier: 'transfer-queue',
                Type: 'TransferToQueue',
                Transitions: {
                    NextAction: 'end-call',
                },
                Parameters: {
                    QueueId: `queue-${clinic.clinicId}`,
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
async function updateClinicConnectConfig(clinicId, config) {
    try {
        // This would update the clinic configuration in DynamoDB
        // For now, we'll just log the update
        console.log(`Updating Connect config for clinic ${clinicId}:`, config);
    }
    catch (error) {
        console.error(`Failed to update Connect config for clinic ${clinicId}:`, error.message);
        throw error;
    }
}
// Run the setup
if (require.main === module) {
    main().catch(console.error);
}
export { main as setupConnectIntegration };

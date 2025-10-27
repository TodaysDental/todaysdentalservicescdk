import {
    ConnectClient,
    CreateQueueCommand,
    CreateRoutingProfileCommand,
    ListQueuesCommand,
    ListRoutingProfilesCommand,
    CreateQuickConnectCommand,
    QuickConnectType,
    QuickConnectConfig,
    Channel
} from '@aws-sdk/client-connect';
import { ConnectResourceManager } from './ConnectResourceManager';
import clinicsData from '../configs/clinics.json';

const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;
const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function createOutboundQuickConnect(
    instanceId: string,
    phoneNumber: string,
    description: string
) {
    const name = `Outbound_${phoneNumber.replace(/\D/g, '')}`;
    
    const quickConnectConfig: QuickConnectConfig = {
        QuickConnectType: QuickConnectType.PHONE_NUMBER,
        PhoneConfig: {
            PhoneNumber: phoneNumber
        }
    };

    try {
        const response = await connect.send(new CreateQuickConnectCommand({
            InstanceId: instanceId,
            Name: name,
            Description: description,
            QuickConnectConfig: quickConnectConfig
        }));
        return response.QuickConnectId;
    } catch (err: any) {
        if (err.name === 'DuplicateResourceException') {
            console.log(`Quick connect ${name} already exists`);
            return null;
        }
        throw err;
    }
}

export async function setupClinicRoutingInfrastructure() {
    // Initialize the Connect Resource Manager
    const resourceManager = new ConnectResourceManager(
        CONNECT_INSTANCE_ID,
        process.env.CONNECT_CONFIG_TABLE || 'connect-config'
    );

    // 1. Get all clinic IDs from your clinics data
    const clinicIds = clinicsData.map((clinic: any) => clinic.clinicId);
    console.log(`Setting up Attribute-Based Routing infrastructure for ${clinicIds.length} clinics`);
    
    // Refresh Connect resources before proceeding
    await resourceManager.refreshConnectResources();

    // 2. Create one queue per clinic (not combinations!)
    const queueMap = new Map<string, string>(); // clinicId -> queueId mapping
    for (const clinic of clinicsData) {
        const queueName = `q-${clinic.clinicId}`;
        try {
            const queueResponse = await connect.send(new CreateQueueCommand({
                InstanceId: CONNECT_INSTANCE_ID,
                Name: queueName,
                Description: `Queue for ${clinic.clinicName}`,
                HoursOfOperationId: process.env.CONNECT_HOURS_OF_OPERATION_ID || 'default-hours-id',
                MaxContacts: 100,
                OutboundCallerConfig: {
                    OutboundCallerIdName: 'Today\'s Dental Insights',
                    OutboundCallerIdNumberId: process.env.CONNECT_OUTBOUND_NUMBER_ID,
                    OutboundFlowId: process.env.CONNECT_OUTBOUND_FLOW_ID
                },
                QuickConnectIds: [
                    process.env.CONNECT_CHATBOT_QUICK_CONNECT_ID!  // After-hours chatbot
                ]
            }));
            queueMap.set(clinic.clinicId, queueResponse.QueueId!);
            console.log(`Created queue ${queueName} with ID ${queueResponse.QueueId}`);
        } catch (err: any) {
            if (err.name === 'DuplicateResourceException') {
                // Queue exists, get its ID
                const listResponse = await connect.send(new ListQueuesCommand({
                    InstanceId: CONNECT_INSTANCE_ID,
                    QueueTypes: ['STANDARD'],
                    MaxResults: 100
                }));
                const queue = listResponse.QueueSummaryList?.find(q => q.Name === queueName);
                if (queue?.Id) {
                    queueMap.set(clinic.clinicId, queue.Id);
                    console.log(`Queue ${queueName} already exists with ID ${queue.Id}`);
                }
            } else {
                console.error(`Failed to create queue ${queueName}:`, err);
                throw err;
            }
        }
    }

    // 3. Create ONE master routing profile (not per combination!)
    const masterProfileName = 'rp-MasterAgent';
    let masterProfileId: string;

    try {
        // Create routing profile with all clinic queues (ABR doesn't require specific queue associations)
        const queueConfigs = Array.from(queueMap.entries()).map(([clinicId, queueId]) => ({
            QueueReference: {
                QueueId: queueId,
                Channel: Channel.VOICE
            },
            Priority: 1,
            Delay: 0
        }));

        const profileResponse = await connect.send(new CreateRoutingProfileCommand({
            InstanceId: CONNECT_INSTANCE_ID,
            Name: masterProfileName,
            Description: 'Master routing profile for all clinics (Attribute-Based Routing)',
            DefaultOutboundQueueId: queueConfigs[0].QueueReference.QueueId,
            MediaConcurrencies: [{ Channel: Channel.VOICE, Concurrency: 1 }],
            QueueConfigs: queueConfigs
        }));

        masterProfileId = profileResponse.RoutingProfileId!;
        console.log(`Created master routing profile ${masterProfileName} with ID ${masterProfileId}`);
    } catch (err: any) {
        if (err.name === 'DuplicateResourceException') {
            // Profile exists, get its ID
            const listResponse = await connect.send(new ListRoutingProfilesCommand({
                InstanceId: CONNECT_INSTANCE_ID,
                MaxResults: 100
            }));
            const profile = listResponse.RoutingProfileSummaryList?.find(p => p.Name === masterProfileName);
            if (profile?.Id) {
                masterProfileId = profile.Id;
                console.log(`Master routing profile ${masterProfileName} already exists with ID ${masterProfileId}`);
            } else {
                throw new Error('Master routing profile not found and could not be created');
            }
        } else {
            console.error(`Failed to create master routing profile ${masterProfileName}:`, err);
            throw err;
        }
    }

    // 4. Return the simplified mappings for reference
    return {
        queues: Object.fromEntries(queueMap), // clinicId -> queueId
        routingProfiles: {
            master: masterProfileId // Single master profile for all agents
        },
        masterProfileId
    };
}
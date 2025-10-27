import {
    ConnectClient,
    CreateQueueCommand,
    CreateRoutingProfileCommand,
    ListQueuesCommand,
    ListRoutingProfilesCommand,
    CreateQuickConnectCommand,
    QuickConnectType,
    Channel
} from '@aws-sdk/client-connect';
import { ConnectResourceManager } from '../ConnectResourceManager';
import { cleanupRemovedClinics } from '../cleanupRemovedClinics';
import { RetryableConnect } from '../RetryableConnect';
import clinicsData from '../../configs/clinics.json';

const connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
const retryableConnect = new RetryableConnect(connect);
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID!;

export async function handler(event: any) {
    console.log('Received event:', JSON.stringify(event, null, 2));

    try {
        if (event.RequestType === 'Delete') {
            // No cleanup needed for Connect resources
            return {
                PhysicalResourceId: 'ClinicRoutingSetup',
                Data: {}
            };
        }

        // Initialize the resource manager
        const resourceManager = new ConnectResourceManager(
            CONNECT_INSTANCE_ID,
            process.env.CONNECT_CONFIG_TABLE!
        );

        // Get all clinic IDs from clinics data
        const clinicIds = clinicsData.map((clinic: any) => clinic.clinicId);
        console.log(`Setting up routing for ${clinicIds.length} clinics`);

        // Clean up queues for removed clinics first
        await cleanupRemovedClinics(connect, CONNECT_INSTANCE_ID, clinicIds);

        // Create queues for each clinic
        const queueMap = new Map<string, string>();
        for (const clinic of clinicsData) {
            const queueName = `q-${clinic.clinicId}`;
            try {
                const queueResponse = await retryableConnect.retry(() => connect.send(new CreateQueueCommand({
                    InstanceId: CONNECT_INSTANCE_ID,
                    Name: queueName,
                    Description: `Queue for ${clinic.clinicName}`,
                    HoursOfOperationId: process.env.CONNECT_HOURS_OF_OPERATION_ID!,
                    MaxContacts: 100,
                    OutboundCallerConfig: process.env.CONNECT_OUTBOUND_NUMBER_ID ? {
                        OutboundCallerIdName: 'Today\'s Dental Insights',
                        OutboundCallerIdNumberId: process.env.CONNECT_OUTBOUND_NUMBER_ID,
                        OutboundFlowId: process.env.CONNECT_OUTBOUND_FLOW_ID
                    } : undefined,
                    QuickConnectIds: process.env.CONNECT_CHATBOT_QUICK_CONNECT_ID ? 
                        [process.env.CONNECT_CHATBOT_QUICK_CONNECT_ID] : undefined
                })));
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

        // Create routing profiles with max 5 queues each (10 queue configs including both channels)
        const QUEUES_PER_PROFILE = 5;
        const queueEntries = Array.from(queueMap.entries());
        const profileCount = Math.ceil(queueEntries.length / QUEUES_PER_PROFILE);
        
        for (let i = 0; i < profileCount; i++) {
            const profileQueues = queueEntries.slice(i * QUEUES_PER_PROFILE, (i + 1) * QUEUES_PER_PROFILE);
            const profileName = `rp-MasterAgent-${i + 1}`;
            
            try {
                const routingResponse = await retryableConnect.retry(() => connect.send(new CreateRoutingProfileCommand({
                    InstanceId: CONNECT_INSTANCE_ID,
                    Name: profileName,
                    Description: `Routing profile ${i + 1} of ${profileCount} for clinics`,
                    DefaultOutboundQueueId: profileQueues[0][1], // Use first queue in this profile as default
                    MediaConcurrencies: [
                        { Channel: Channel.VOICE, Concurrency: 1 },
                        { Channel: Channel.CHAT, Concurrency: 5 }
                    ],
                    QueueConfigs: profileQueues.flatMap(([clinicId, queueId]) => [
                        {
                            QueueReference: {
                                QueueId: queueId,
                                Channel: Channel.VOICE
                            },
                            Priority: 1,
                            Delay: 0
                        },
                        {
                            QueueReference: {
                                QueueId: queueId,
                                Channel: Channel.CHAT
                            },
                            Priority: 1,
                            Delay: 0
                        }
                    ])
                })));
                console.log(`Created routing profile ${profileName} with ID ${routingResponse.RoutingProfileId}`);
            } catch (err: any) {
                if (err.name !== 'DuplicateResourceException') {
                    console.error(`Failed to create routing profile ${profileName}:`, err);
                    throw err;
                }
                console.log(`Routing profile ${profileName} already exists`);
            }
        }

        // Refresh Connect resources in DynamoDB
        await resourceManager.refreshConnectResources();

        return {
            PhysicalResourceId: 'ClinicRoutingSetup',
            Data: {
                message: `Successfully set up routing for ${clinicIds.length} clinics`
            }
        };
    } catch (error) {
        console.error('Failed to set up clinic routing:', error);
        throw error;
    }
}
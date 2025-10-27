import {
    ConnectClient,
    ListQueuesCommand,
    DeleteQueueCommand,
    UpdateRoutingProfileQueuesCommand,
    ListRoutingProfileQueuesCommand
} from '@aws-sdk/client-connect';

export async function cleanupRemovedClinics(
    connect: ConnectClient,
    instanceId: string,
    currentClinicIds: string[],
    masterRoutingProfileId?: string
) {
    console.log('Starting cleanup of removed clinics');
    
    // Get all existing queues
    const existingQueues = await listAllQueues(connect, instanceId);
    
    // Filter clinic queues (those starting with 'q-')
    const clinicQueues = existingQueues.filter(q => q.Name?.startsWith('q-'));
    
    // Find queues for removed clinics
    const removedQueues = clinicQueues.filter(q => {
        const queueClinicId = q.Name?.replace('q-', '');
        return !currentClinicIds.includes(queueClinicId || '');
    });
    
    if (removedQueues.length === 0) {
        console.log('No removed clinic queues found');
        return;
    }
    
    console.log(`Found ${removedQueues.length} queues to remove:`, 
        removedQueues.map(q => q.Name).join(', '));

    // If we have a master routing profile, remove these queues from it first
    if (masterRoutingProfileId) {
        await removeQueuesFromRoutingProfile(
            connect,
            instanceId,
            masterRoutingProfileId,
            removedQueues.map(q => q.Id!).filter(Boolean)
        );
    }

    // Delete each queue
    for (const queue of removedQueues) {
        if (!queue.Id) continue;

        try {
            await connect.send(new DeleteQueueCommand({
                InstanceId: instanceId,
                QueueId: queue.Id
            }));

            console.log(`Successfully deleted queue ${queue.Name}`);
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                console.log(`Queue ${queue.Name} already deleted`);
            } else {
                console.error(`Failed to delete queue ${queue.Name}:`, error);
                throw error;
            }
        }
    }
}

async function listAllQueues(connect: ConnectClient, instanceId: string) {
    const queues: Array<{ Id?: string; Name?: string }> = [];
    let nextToken: string | undefined;
    
    do {
        const response = await connect.send(new ListQueuesCommand({
            InstanceId: instanceId,
            QueueTypes: ['STANDARD'],
            MaxResults: 100,
            NextToken: nextToken
        }));
        
        if (response.QueueSummaryList) {
            queues.push(...response.QueueSummaryList);
        }
        
        nextToken = response.NextToken;
    } while (nextToken);
    
    return queues;
}

async function removeQueuesFromRoutingProfile(
    connect: ConnectClient,
    instanceId: string,
    routingProfileId: string,
    queueIdsToRemove: string[]
) {
    // Get current queue configs
    const response = await connect.send(new ListRoutingProfileQueuesCommand({
        InstanceId: instanceId,
        RoutingProfileId: routingProfileId,
        MaxResults: 100
    }));

    // Filter out the queues we want to remove
    const remainingQueues = response.RoutingProfileQueueConfigSummaryList?.filter(
        config => config.QueueId && !queueIdsToRemove.includes(config.QueueId)
    ) || [];

    if (remainingQueues.length === 0) {
        console.warn('Cannot remove all queues from routing profile, must have at least one');
        return;
    }

    // Update routing profile with remaining queues
    await connect.send(new UpdateRoutingProfileQueuesCommand({
        InstanceId: instanceId,
        RoutingProfileId: routingProfileId,
        QueueConfigs: remainingQueues.map(q => ({
            Priority: q.Priority,
            Delay: q.Delay,
            QueueReference: {
                QueueId: q.QueueId,
                Channel: q.Channel
            }
        }))
    }));

    console.log(`Removed ${queueIdsToRemove.length} queues from routing profile ${routingProfileId}`);
}
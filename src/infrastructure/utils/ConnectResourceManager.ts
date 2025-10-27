import {
    ConnectClient,
    ListSecurityProfilesCommand,
    ListRoutingProfilesCommand,
    ListQueuesCommand,
    SecurityProfileSummary,
    RoutingProfileSummary,
    QueueSummary
} from '@aws-sdk/client-connect';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RetryableConnect } from './RetryableConnect';

export class ConnectResourceManager {
    private connect: ConnectClient;
    private retryableConnect: RetryableConnect;
    private ddb: DynamoDBDocumentClient;
    private instanceId: string;
    private configTableName: string;

    constructor(instanceId: string, configTableName: string) {
        this.connect = new ConnectClient({ region: process.env.AWS_REGION || 'us-east-1' });
        this.retryableConnect = new RetryableConnect(this.connect);
        this.ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
        this.instanceId = instanceId;
        this.configTableName = configTableName;
    }

    async refreshConnectResources(): Promise<void> {
        // Fetch all current resources
        const [securityProfiles, routingProfiles, queues] = await Promise.all([
            this.getSecurityProfiles(),
            this.getRoutingProfiles(),
            this.getQueues()
        ]);

        // Update DynamoDB with current resource IDs
        await this.updateResourceConfig({
            securityProfiles: this.mapProfilesToConfig(securityProfiles),
            routingProfiles: this.mapProfilesToConfig(routingProfiles),
            queues: this.mapQueuesToConfig(queues),
            lastUpdated: new Date().toISOString()
        });
    }

    private async getSecurityProfiles(): Promise<SecurityProfileSummary[]> {
        const response = await this.retryableConnect.retry(() => 
            this.connect.send(new ListSecurityProfilesCommand({
                InstanceId: this.instanceId,
                MaxResults: 100
            }))
        );
        return response.SecurityProfileSummaryList || [];
    }

    private async getRoutingProfiles(): Promise<RoutingProfileSummary[]> {
        const response = await this.connect.send(new ListRoutingProfilesCommand({
            InstanceId: this.instanceId,
            MaxResults: 100
        }));
        return response.RoutingProfileSummaryList || [];
    }

    private async getQueues(): Promise<QueueSummary[]> {
        const response = await this.connect.send(new ListQueuesCommand({
            InstanceId: this.instanceId,
            MaxResults: 100
        }));
        return response.QueueSummaryList || [];
    }

    private mapProfilesToConfig(profiles: (SecurityProfileSummary | RoutingProfileSummary)[]): Record<string, string> {
        return profiles.reduce((acc, profile) => {
            if (profile.Name && profile.Id) {
                // Convert name to uppercase and replace spaces/special chars with underscores
                const key = profile.Name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
                acc[key] = profile.Id;
            }
            return acc;
        }, {} as Record<string, string>);
    }

    private mapQueuesToConfig(queues: QueueSummary[]): Record<string, string> {
        return queues.reduce((acc, queue) => {
            if (queue.Name && queue.Id) {
                // Extract clinic ID from queue name (assuming format q-{clinicId})
                const clinicId = queue.Name.replace('q-', '');
                acc[clinicId] = queue.Id;
            }
            return acc;
        }, {} as Record<string, string>);
    }

    private async updateResourceConfig(config: any): Promise<void> {
        await this.ddb.send(new UpdateCommand({
            TableName: this.configTableName,
            Key: { configId: 'connect-resources' },
            UpdateExpression: 'SET securityProfiles = :sp, routingProfiles = :rp, queues = :q, lastUpdated = :lu',
            ExpressionAttributeValues: {
                ':sp': config.securityProfiles,
                ':rp': config.routingProfiles,
                ':q': config.queues,
                ':lu': config.lastUpdated
            }
        }));
    }
}
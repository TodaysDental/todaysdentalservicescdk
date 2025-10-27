import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export interface ConnectConfig {
    INSTANCE_ID: string;
    INSTANCE_ARN: string;
    SECURITY_PROFILES: Record<string, string>;
    ROUTING_PROFILES: Record<string, string>;
    QUEUES: Record<string, string>;
    lastUpdated?: string;
}

// Default config as fallback
const DEFAULT_CONFIG: ConnectConfig = {
    INSTANCE_ID: 'e265b644-3dad-4490-b7c4-27036090c5f1',
    INSTANCE_ARN: 'arn:aws:connect:us-east-1:851620242036:instance/e265b644-3dad-4490-b7c4-27036090c5f1',
    SECURITY_PROFILES: {
        AGENT: '04b0e801-6c86-4a57-9348-32a5623e466a',         // Agent
        ADMIN: 'cfe52edd-a315-4c8a-baa6-6b8179713379',         // Admin
        SUPER_ADMIN: 'ce2e8591-c051-402d-888a-ded12fab06c9',   // SUPER_ADMIN
        CALL_CENTER_MANAGER: 'cd9cfd94-8ce4-44bc-aebb-1d71ca0c7736' // CallCenterManager
    },
    ROUTING_PROFILES: {
        GLOBAL_ALL_CLINICS: '36f58a4c-e1d6-425d-87fd-e0ec60a0a2e0', // global_all_clinics_routing
        MASTER_AGENT: 'bcdb40df-326f-4315-a685-c4951f10f76e',       // rp-MasterAgent
        BASIC: 'c365bce9-ea46-474b-b6a1-90dc2eac511c'              // Basic Routing Profile
    },
    QUEUES: {}
};

export async function getConnectConfig(): Promise<ConnectConfig> {
    try {
        const configTable = process.env.CONNECT_CONFIG_TABLE || 'connect-config';
        const result = await ddb.send(new GetCommand({
            TableName: configTable,
            Key: { configId: 'connect-resources' }
        }));

        if (!result.Item) {
            console.warn('No Connect config found in DynamoDB, using default config');
            return DEFAULT_CONFIG;
        }

        return {
            INSTANCE_ID: DEFAULT_CONFIG.INSTANCE_ID,
            INSTANCE_ARN: DEFAULT_CONFIG.INSTANCE_ARN,
            SECURITY_PROFILES: result.Item.securityProfiles || DEFAULT_CONFIG.SECURITY_PROFILES,
            ROUTING_PROFILES: result.Item.routingProfiles || DEFAULT_CONFIG.ROUTING_PROFILES,
            QUEUES: result.Item.queues || {},
            lastUpdated: result.Item.lastUpdated
        };
    } catch (error) {
        console.error('Error fetching Connect config:', error);
        return DEFAULT_CONFIG;
    }
}

// Export the default config for immediate use, but provide async getter for dynamic config
export const CONNECT_CONFIG = DEFAULT_CONFIG;
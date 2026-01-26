import {
    CloudFormationCustomResourceEvent,
    CloudFormationCustomResourceResponse
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.CLINIC_BUDGET_TABLE || 'ClinicDailyBudget';
const INITIAL_DATA = process.env.INITIAL_DATA || '[]';

interface BudgetItem {
    clinicName: string;
    dailyBudget: number;
}

export const handler = async (
    event: CloudFormationCustomResourceEvent
): Promise<CloudFormationCustomResourceResponse> => {
    console.log('Seeder event:', JSON.stringify(event, null, 2));

    const requestType = event.RequestType;

    try {
        if (requestType === 'Create' || requestType === 'Update') {
            // Parse initial data from environment variable
            const items: BudgetItem[] = JSON.parse(INITIAL_DATA);
            console.log(`Seeding ${items.length} clinic budget records...`);

            const now = new Date().toISOString();

            // Use BatchWrite for efficiency (max 25 items per batch)
            const batchSize = 25;
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);

                const putRequests = batch.map(item => ({
                    PutRequest: {
                        Item: {
                            clinicName: item.clinicName,
                            dailyBudget: item.dailyBudget,
                            currency: 'USD',
                            createdAt: now,
                            updatedAt: now,
                            updatedBy: 'system-seeder',
                        }
                    }
                }));

                await ddb.send(new BatchWriteCommand({
                    RequestItems: {
                        [TABLE]: putRequests
                    }
                }));

                console.log(`Seeded batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)`);
            }

            console.log('Seeding completed successfully');
        } else if (requestType === 'Delete') {
            // On delete, we don't remove the data (RETAIN policy on table)
            console.log('Delete request - data will be retained');
        }

        return {
            Status: 'SUCCESS',
            PhysicalResourceId: `clinic-budget-seeder-${event.LogicalResourceId}`,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Data: {
                Message: `Successfully processed ${requestType} request`,
            },
        };
    } catch (error: any) {
        console.error('Seeder error:', error);

        return {
            Status: 'FAILED',
            Reason: error.message || 'Unknown error during seeding',
            PhysicalResourceId: `clinic-budget-seeder-${event.LogicalResourceId}`,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
        };
    }
};

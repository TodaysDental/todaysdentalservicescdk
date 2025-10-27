import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import clinics from '../src/infrastructure/configs/clinics.json';

async function ensureTable(client: DynamoDBClient, tableName: string) {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`✔ Table exists: ${tableName}`);
    return;
  } catch (err: any) {
    if (err?.name !== 'ResourceNotFoundException') throw err;
  }
  console.log(`➕ Creating table: ${tableName}`);
  await client.send(new CreateTableCommand({
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'RequestID', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'RequestID', KeyType: 'HASH' }],
  }));
  console.log(`⏳ Waiting a few seconds for table to become ACTIVE: ${tableName}`);
}

async function main() {
  const region = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
  const client = new DynamoDBClient({ region });
  for (const c of clinics as any[]) {
    const clinicId = String(c.clinicId);
    const name = `RequestCallBacks_${clinicId}`;
    await ensureTable(client, name);
  }
  console.log('✅ Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



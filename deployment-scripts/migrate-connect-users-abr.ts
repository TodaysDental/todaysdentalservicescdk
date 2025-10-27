#!/usr/bin/env node

/**
 * Migration Script: Convert from old Connect user schema to ABR schema
 *
 * Old schema: userId + clinicId (composite key) - separate Connect user per clinic
 * New schema: userId (single key) - one Connect user with multiple clinic proficiencies
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ConnectClient, DeleteUserCommand, UpdateUserProficienciesCommand } from '@aws-sdk/client-connect';
import { buildProficiencies } from '../src/infrastructure/utils/clinicCombinations';

const REGION = 'us-east-1';
const CONNECT_INSTANCE_ID = process.env.CONNECT_INSTANCE_ID || 'e265b644-3dad-4490-b7c4-27036090c5f1';
const OLD_TABLE_NAME = 'TodaysDentalInsightsConnectV1-ConnectUsers-V1'; // Old table with composite key
const NEW_TABLE_NAME = 'TodaysDentalInsightsConnectV1-ConnectUsers-ABR-V1'; // New table with single key

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const connect = new ConnectClient({ region: REGION });

interface OldConnectUserRecord {
  userId: string;
  clinicId: string;
  connectUserId: string;
  connectUserArn?: string;
  email: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

interface NewConnectUserRecord {
  userId: string;
  clinics: string[];
  connectUserId: string;
  connectUserArn?: string;
  email: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

async function migrateConnectUsers() {
  console.log('🚀 Starting Connect users migration to ABR schema...');

  try {
    // 1. Scan all old records
    console.log('📊 Scanning old Connect users table...');
    const oldRecords = await scanAllOldRecords();
    console.log(`Found ${oldRecords.length} old records to migrate`);

    // 2. Group by userId (consolidate multiple clinic assignments per user)
    const userGroups = groupByUserId(oldRecords);
    console.log(`Found ${Object.keys(userGroups).length} unique users to migrate`);

    // 3. Create new records with ABR schema
    console.log('🔄 Creating new ABR records...');
    let migratedCount = 0;
    let errorCount = 0;

    for (const [userId, oldRecords] of Object.entries(userGroups)) {
      try {
        await migrateUser(oldRecords);
        migratedCount++;
        console.log(`✅ Migrated user ${userId} (${oldRecords.length} clinics)`);
      } catch (error: any) {
        console.error(`❌ Failed to migrate user ${userId}:`, error.message);
        errorCount++;
      }
    }

    console.log('✅ Migration completed!');
    console.log(`📋 Summary: ${migratedCount} users migrated, ${errorCount} errors`);

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

async function scanAllOldRecords(): Promise<OldConnectUserRecord[]> {
  const records: OldConnectUserRecord[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const command = new ScanCommand({
      TableName: OLD_TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const result = await ddb.send(command);
    if (result.Items) {
      records.push(...(result.Items as OldConnectUserRecord[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return records;
}

function groupByUserId(records: OldConnectUserRecord[]): Record<string, OldConnectUserRecord[]> {
  const groups: Record<string, OldConnectUserRecord[]> = {};

  for (const record of records) {
    if (!groups[record.userId]) {
      groups[record.userId] = [];
    }
    groups[record.userId].push(record);
  }

  return groups;
}

async function migrateUser(oldRecords: OldConnectUserRecord[]): Promise<void> {
  // Get the first record to use as base (they should all have same email, created info)
  const baseRecord = oldRecords[0];

  // Collect all clinic IDs
  const clinicIds = oldRecords.map(record => record.clinicId).sort();

  // Delete old Connect users (all except the first one)
  for (let i = 1; i < oldRecords.length; i++) {
    await connect.send(new DeleteUserCommand({
      InstanceId: CONNECT_INSTANCE_ID,
      UserId: oldRecords[i].connectUserId,
    }));
  }

  // Update the remaining Connect user with proficiencies
  await updateConnectUserProficiencies(baseRecord.connectUserId, clinicIds);

  // Create new record in ABR schema
  const newRecord: NewConnectUserRecord = {
    userId: baseRecord.userId,
    clinics: clinicIds,
    connectUserId: baseRecord.connectUserId,
    connectUserArn: baseRecord.connectUserArn,
    email: baseRecord.email,
    createdAt: baseRecord.createdAt,
    updatedAt: Date.now(),
    createdBy: baseRecord.createdBy,
  };

  await ddb.send(new PutCommand({
    TableName: NEW_TABLE_NAME,
    Item: newRecord,
  }));

  // Delete old records
  for (const oldRecord of oldRecords) {
    await ddb.send(new DeleteCommand({
      TableName: OLD_TABLE_NAME,
      Key: {
        userId: oldRecord.userId,
        clinicId: oldRecord.clinicId,
      },
    }));
  }
}

async function updateConnectUserProficiencies(connectUserId: string, clinics: string[]): Promise<void> {
  const proficiencies = buildProficiencies(clinics);

  await connect.send(new UpdateUserProficienciesCommand({
    InstanceId: CONNECT_INSTANCE_ID,
    UserId: connectUserId,
    Proficiencies: proficiencies,
  }));
}

// Run migration
if (require.main === module) {
  migrateConnectUsers().catch(console.error);
}

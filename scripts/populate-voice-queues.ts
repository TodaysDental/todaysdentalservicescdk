#!/usr/bin/env node

/**
 * Script to populate VoiceQueues DynamoDB table with clinic phone number mappings
 * Run this after deploying the CDK stack to set up phone number routing
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import clinicsData from '../clinic-config/clinics.json';
const clinics = clinicsData;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const VOICE_QUEUE_TABLE = 'VoiceQueues';

async function populateVoiceQueues() {
  console.log('Populating VoiceQueues table with clinic phone number mappings...');
  
  for (const clinic of clinics) {
    const item = {
      phoneNumber: clinic.phoneNumber,
      clinicId: clinic.clinicId,
      clinicName: clinic.clinicName,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    try {
      await ddb.send(new PutCommand({
        TableName: VOICE_QUEUE_TABLE,
        Item: item
      }));
      
      console.log(`✓ Added mapping: ${clinic.phoneNumber} -> ${clinic.clinicId} (${clinic.clinicName})`);
    } catch (error) {
      console.error(`✗ Failed to add mapping for ${clinic.clinicId}:`, error);
    }
  }
  
  console.log('Phone number mapping population completed.');
}

// Run the script
populateVoiceQueues().catch(console.error);

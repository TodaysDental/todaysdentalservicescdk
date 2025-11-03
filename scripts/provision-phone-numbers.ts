#!/usr/bin/env ts-node

/**
 * AWS Chime Phone Number Provisioning Script
 * 
 * This script automates the process of:
 * 1. Searching for available phone numbers
 * 2. Ordering phone numbers
 * 3. Associating them with Voice Connector
 * 4. Creating inbound SIP Rules
 * 5. Updating ClinicsTable with phone numbers
 * 
 * Usage:
 *   npx ts-node provision-phone-numbers.ts \
 *     --voice-connector-id abc123 \
 *     --sma-id def456 \
 *     --clinics-table MyStack-Clinics \
 *     --clinics clinic1,clinic2 \
 *     --area-codes 800,415 \
 *     --region us-east-1
 */

import { 
  ChimeSDKVoiceClient,
  SearchAvailablePhoneNumbersCommand,
  CreatePhoneNumberOrderCommand,
  GetPhoneNumberOrderCommand,
  AssociatePhoneNumbersWithVoiceConnectorCommand,
  CreateSipRuleCommand,
  PhoneNumberType,
  PhoneNumberOrderStatus
} from '@aws-sdk/client-chime-sdk-voice';

import { 
  DynamoDBClient 
} from '@aws-sdk/client-dynamodb';

import {
  DynamoDBDocumentClient,
  UpdateCommand
} from '@aws-sdk/lib-dynamodb';

interface ProvisionConfig {
  voiceConnectorId: string;
  smaId: string;
  clinicsTable: string;
  clinics: string[];
  areaCodes: string[];
  region: string;
  phoneNumberType: 'Local' | 'TollFree';
}

const parseArgs = (): ProvisionConfig => {
  const args = process.argv.slice(2);
  const config: any = {
    phoneNumberType: 'Local',
    region: 'us-east-1'
  };

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];

    switch (key) {
      case 'voice-connector-id':
        config.voiceConnectorId = value;
        break;
      case 'sma-id':
        config.smaId = value;
        break;
      case 'clinics-table':
        config.clinicsTable = value;
        break;
      case 'clinics':
        config.clinics = value.split(',');
        break;
      case 'area-codes':
        config.areaCodes = value.split(',');
        break;
      case 'region':
        config.region = value;
        break;
      case 'type':
        config.phoneNumberType = value;
        break;
    }
  }

  // Validate required fields
  const required = ['voiceConnectorId', 'smaId', 'clinicsTable', 'clinics', 'areaCodes'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing required argument: --${field}`);
    }
  }

  return config as ProvisionConfig;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function searchPhoneNumbers(
  client: ChimeSDKVoiceClient,
  areaCode: string,
  type: PhoneNumberType
): Promise<string[]> {
  console.log(`Searching for ${type} phone numbers in area code ${areaCode}...`);

  const command = new SearchAvailablePhoneNumbersCommand({
    AreaCode: areaCode,
    Country: 'US',
    PhoneNumberType: type,
    MaxResults: 5
  });

  const response = await client.send(command);
  const numbers = response.E164PhoneNumbers || [];

  console.log(`Found ${numbers.length} available numbers: ${numbers.join(', ')}`);
  return numbers;
}

async function orderPhoneNumber(
  client: ChimeSDKVoiceClient,
  phoneNumber: string
): Promise<string> {
  console.log(`Ordering phone number ${phoneNumber}...`);

  const command = new CreatePhoneNumberOrderCommand({
    ProductType: 'SipMediaApplicationDialIn',
    E164PhoneNumbers: [phoneNumber]
  });

  const response = await client.send(command);
  const orderId = response.PhoneNumberOrder?.PhoneNumberOrderId;

  if (!orderId) {
    throw new Error('Failed to create phone number order');
  }

  console.log(`Order created: ${orderId}. Waiting for completion...`);

  // Poll for order completion
  let attempts = 0;
  const maxAttempts = 30;

  while (attempts < maxAttempts) {
    await sleep(2000); // Wait 2 seconds between polls

    const statusCommand = new GetPhoneNumberOrderCommand({
      PhoneNumberOrderId: orderId
    });

    const statusResponse = await client.send(statusCommand);
    const status = statusResponse.PhoneNumberOrder?.Status;

    console.log(`Order status: ${status}`);

    if (status === PhoneNumberOrderStatus.Successful) {
      console.log(`✓ Phone number ${phoneNumber} successfully provisioned`);
      return phoneNumber;
    } else if (status === PhoneNumberOrderStatus.Failed) {
      throw new Error(`Phone number order failed: ${statusResponse.PhoneNumberOrder?.OrderedPhoneNumbers?.[0]?.Status}`);
    }

    attempts++;
  }

  throw new Error('Phone number order timed out');
}

async function associateWithVoiceConnector(
  client: ChimeSDKVoiceClient,
  voiceConnectorId: string,
  phoneNumbers: string[]
): Promise<void> {
  console.log(`Associating ${phoneNumbers.length} numbers with Voice Connector ${voiceConnectorId}...`);

  const command = new AssociatePhoneNumbersWithVoiceConnectorCommand({
    VoiceConnectorId: voiceConnectorId,
    E164PhoneNumbers: phoneNumbers,
    ForceAssociate: false
  });

  await client.send(command);
  console.log('✓ Phone numbers associated with Voice Connector');
}

async function createSipRule(
  client: ChimeSDKVoiceClient,
  phoneNumber: string,
  smaId: string,
  region: string,
  clinicId: string
): Promise<void> {
  console.log(`Creating SIP Rule for ${phoneNumber} (clinic: ${clinicId})...`);

  const command = new CreateSipRuleCommand({
    Name: `InboundRule-${clinicId}-${phoneNumber.replace('+', '')}`,
    TriggerType: 'ToPhoneNumber',
    TriggerValue: phoneNumber,
    TargetApplications: [{
      SipMediaApplicationId: smaId,
      Priority: 1,
      AwsRegion: region
    }]
  });

  await client.send(command);
  console.log(`✓ SIP Rule created for ${phoneNumber}`);
}

async function updateClinicTable(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  clinicId: string,
  phoneNumber: string
): Promise<void> {
  console.log(`Updating ClinicsTable: ${clinicId} → ${phoneNumber}...`);

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { clinicId },
    UpdateExpression: 'SET phoneNumber = :phone, updatedAt = :timestamp',
    ExpressionAttributeValues: {
      ':phone': phoneNumber,
      ':timestamp': new Date().toISOString()
    }
  });

  await ddb.send(command);
  console.log(`✓ Clinic ${clinicId} updated with phone number ${phoneNumber}`);
}

async function main() {
  try {
    const config = parseArgs();

    console.log('='.repeat(80));
    console.log('AWS Chime Phone Number Provisioning');
    console.log('='.repeat(80));
    console.log(`Voice Connector ID: ${config.voiceConnectorId}`);
    console.log(`SMA ID: ${config.smaId}`);
    console.log(`Clinics Table: ${config.clinicsTable}`);
    console.log(`Clinics: ${config.clinics.join(', ')}`);
    console.log(`Area Codes: ${config.areaCodes.join(', ')}`);
    console.log(`Region: ${config.region}`);
    console.log('='.repeat(80));

    if (config.clinics.length !== config.areaCodes.length) {
      throw new Error('Number of clinics must match number of area codes');
    }

    const chimeVoice = new ChimeSDKVoiceClient({ region: config.region });
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }));

    const provisionedNumbers: { clinicId: string; phoneNumber: string }[] = [];

    // Step 1 & 2: Search and order phone numbers
    for (let i = 0; i < config.clinics.length; i++) {
      const clinicId = config.clinics[i];
      const areaCode = config.areaCodes[i];

      console.log(`\n[${ i + 1}/${config.clinics.length}] Processing clinic: ${clinicId}`);

      // Search for available numbers
      const availableNumbers = await searchPhoneNumbers(
        chimeVoice,
        areaCode,
        config.phoneNumberType as PhoneNumberType
      );

      if (availableNumbers.length === 0) {
        throw new Error(`No available phone numbers found for area code ${areaCode}`);
      }

      // Order the first available number
      const phoneNumber = await orderPhoneNumber(chimeVoice, availableNumbers[0]);
      provisionedNumbers.push({ clinicId, phoneNumber });
    }

    console.log('\n' + '='.repeat(80));
    console.log('Phone Number Ordering Complete');
    console.log('='.repeat(80));

    // Step 3: Associate all numbers with Voice Connector
    console.log('\nStep 3: Associating numbers with Voice Connector...\n');
    await associateWithVoiceConnector(
      chimeVoice,
      config.voiceConnectorId,
      provisionedNumbers.map(p => p.phoneNumber)
    );

    // Step 4: Create SIP Rules
    console.log('\nStep 4: Creating SIP Rules...\n');
    for (const { clinicId, phoneNumber } of provisionedNumbers) {
      await createSipRule(chimeVoice, phoneNumber, config.smaId, config.region, clinicId);
    }

    // Step 5: Update ClinicsTable
    console.log('\nStep 5: Updating ClinicsTable...\n');
    for (const { clinicId, phoneNumber } of provisionedNumbers) {
      await updateClinicTable(ddb, config.clinicsTable, clinicId, phoneNumber);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✓ Provisioning Complete!');
    console.log('='.repeat(80));
    console.log('\nProvisioned Numbers:');
    for (const { clinicId, phoneNumber } of provisionedNumbers) {
      console.log(`  ${clinicId}: ${phoneNumber}`);
    }
    console.log('\nYour contact center is now ready to receive inbound calls!');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();


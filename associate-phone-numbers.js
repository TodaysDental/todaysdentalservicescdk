#!/usr/bin/env node

/**
 * Script to associate phone numbers with the Chime Voice Connector
 * 
 * This script:
 * 1. Lists all phone numbers from the AWS account
 * 2. Filters for VoiceConnector product type and Unassigned status
 * 3. Associates them with the specified Voice Connector
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const VOICE_CONNECTOR_ID = 'dudmzbtcalsw6kiyomglee'; // Update this if needed
const BATCH_SIZE = 10; // Process phone numbers in batches

// Helper function to run AWS CLI commands
function runAwsCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing: ${command}`);
        console.error(stderr);
        reject(error);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (parseError) {
        console.error(`Error parsing JSON: ${stdout}`);
        reject(parseError);
      }
    });
  });
}

// Main function
async function associatePhoneNumbers() {
  try {
    console.log('Listing all phone numbers...');
    const phoneNumbersResult = await runAwsCommand('aws chime-sdk-voice list-phone-numbers');
    
    // Filter for voice connector product type and unassigned status
    const eligibleNumbers = phoneNumbersResult.PhoneNumbers.filter(phone => 
      phone.ProductType === 'VoiceConnector' && 
      phone.Status === 'Unassigned' &&
      phone.Associations.length === 0
    );
    
    console.log(`Found ${eligibleNumbers.length} eligible phone numbers to associate`);
    
    if (eligibleNumbers.length === 0) {
      console.log('No eligible phone numbers found.');
      return;
    }
    
    // Process in batches
    const batches = [];
    for (let i = 0; i < eligibleNumbers.length; i += BATCH_SIZE) {
      batches.push(eligibleNumbers.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Processing ${batches.length} batches of phone numbers...`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const phoneNumbers = batch.map(p => p.E164PhoneNumber);
      
      console.log(`Processing batch ${i + 1}/${batches.length} with ${phoneNumbers.length} numbers:`);
      console.log(phoneNumbers);
      
      const associateCommand = `aws chime-sdk-voice associate-phone-numbers-with-voice-connector --voice-connector-id ${VOICE_CONNECTOR_ID} --e164-phone-numbers ${phoneNumbers.join(' ')} --force-associate`;
      
      console.log('Associating phone numbers...');
      const result = await runAwsCommand(associateCommand);
      
      if (result.PhoneNumberAssociations) {
        const successful = result.PhoneNumberAssociations.filter(a => a.Status === 'Successful').length;
        const failed = result.PhoneNumberAssociations.filter(a => a.Status !== 'Successful').length;
        
        console.log(`Batch ${i + 1} results: ${successful} successful, ${failed} failed`);
        
        if (failed > 0) {
          console.log('Failed associations:');
          result.PhoneNumberAssociations
            .filter(a => a.Status !== 'Successful')
            .forEach(a => console.log(`  ${a.E164PhoneNumber}: ${a.Status} - ${a.ErrorMessage || 'No error message'}`));
        }
      }
      
      // Small delay between batches
      if (i < batches.length - 1) {
        console.log('Waiting 2 seconds before processing next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('Phone number association completed.');
    
  } catch (error) {
    console.error('Error associating phone numbers:', error);
    process.exit(1);
  }
}

// Run the script
associatePhoneNumbers();

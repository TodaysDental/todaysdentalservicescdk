#!/usr/bin/env node
// Script to load clinic data from clinics.json into the Chime Clinics DynamoDB table
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

// Configure these values
const REGION = 'us-east-1'; // Replace with your region if different
const TABLE_NAME = 'TodaysDentalInsightsChimeN1-Clinics'; // Replace if your table name is different

// Initialize DynamoDB client
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function loadClinicsData() {
    try {
        // Read clinics data from JSON file
        const clinicsJsonPath = path.join(__dirname, '..', 'src', 'infrastructure', 'configs', 'clinics.json');
        const clinicsData = JSON.parse(fs.readFileSync(clinicsJsonPath, 'utf-8'));
        
        console.log(`Found ${clinicsData.length} clinics in clinics.json`);
        
        // Process and insert each clinic
        let successCount = 0;
        let errorCount = 0;
        
        for (const clinic of clinicsData) {
            try {
                // Skip if missing required fields
                if (!clinic.phoneNumber || !clinic.clinicId) {
                    console.log(`Skipping ${clinic.clinicId || 'unknown'} - Missing clinicId or phoneNumber`);
                    continue;
                }
                
                // Copy ALL fields from clinics.json to preserve OpenDental credentials and other config
                const item = { ...clinic };
                
                // Validate OpenDental credentials exist
                if (!item.developerKey || !item.customerKey) {
                    console.warn(`Warning: ${clinic.clinicId} missing OpenDental credentials (developerKey/customerKey)`);
                }
                
                console.log(`Inserting clinic ${clinic.clinicId} with phone ${item.phoneNumber} (has credentials: ${!!item.developerKey && !!item.customerKey})`);
                
                // Insert into DynamoDB
                await ddb.send(new PutCommand({
                    TableName: TABLE_NAME,
                    Item: item
                }));
                
                successCount++;
            } catch (clinicError) {
                console.error(`Error inserting clinic ${clinic.clinicId}:`, clinicError);
                errorCount++;
            }
        }
        
        console.log(`Completed processing ${clinicsData.length} clinics`);
        console.log(`Successful: ${successCount}, Errors: ${errorCount}`);
        
    } catch (err) {
        console.error('Failed to load clinics data:', err);
    }
}

// Execute the function
loadClinicsData().then(() => {
    console.log('Script execution completed');
});


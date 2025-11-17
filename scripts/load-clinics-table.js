#!/usr/bin/env node
// Script to load clinic data from clinics.json into the Chime Clinics DynamoDB table
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

// Configure these values
const REGION = 'us-east-1'; // Replace with your region if different
const TABLE_NAME = 'TodaysDentalInsightsChimeV23-Clinics'; // Replace if your table name is different

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
                // Create item for DynamoDB insertion
                const item = {
                    clinicId: clinic.clinicId,
                    phoneNumber: clinic.phoneNumber || null,
                    clinicName: clinic.clinicName || clinic.clinicId,
                    // Add any other fields you need in the clinics table
                };
                
                // Skip if no phone number
                if (!item.phoneNumber) {
                    console.log(`Skipping ${clinic.clinicId} - No phone number defined`);
                    continue;
                }
                
                console.log(`Inserting clinic ${clinic.clinicId} with phone ${item.phoneNumber}`);
                
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

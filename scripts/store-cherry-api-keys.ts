/// <reference types="node" />
/**
 * Script to store Cherry API keys in the ClinicSecrets DynamoDB table.
 * 
 * Usage:
 *   npx ts-node scripts/store-cherry-api-keys.ts
 * 
 * Prerequisites:
 *   - AWS credentials configured (aws configure, or IAM role)
 *   - Region set to us-east-1 (or wherever the table resides)
 * 
 * This script updates each clinic's ClinicSecrets entry to add the cherryApiKey field.
 * It uses UpdateItem (not PutItem) so it does NOT overwrite other secrets.
 */

import { DynamoDBClient, UpdateItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import * as path from 'path';
import * as fs from 'fs';

const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.CLINIC_SECRETS_TABLE || 'TodaysDentalInsights-ClinicSecrets';

const dynamo = new DynamoDBClient({ region: REGION });

// ============================================
// Load clinic config to get correct clinicId values
// ============================================
interface ClinicConfigEntry {
    clinicId: string;
    clinicName: string;
    clinicCity: string;
}

const clinicConfigPath = path.resolve(__dirname, '../src/infrastructure/configs/clinic-config.json');
const clinicConfig: ClinicConfigEntry[] = JSON.parse(fs.readFileSync(clinicConfigPath, 'utf-8'));

// Build lookup maps from clinic-config.json
const configByCity = new Map<string, ClinicConfigEntry>();
const configById = new Map<string, ClinicConfigEntry>();
for (const clinic of clinicConfig) {
    configById.set(clinic.clinicId.toLowerCase(), clinic);
    // Map by city (lowercase) — note: some cities are duplicated (e.g., Greenville, Austin, San Antonio)
    // We store the last match; the explicit mapping below handles duplicates
    configByCity.set(clinic.clinicCity.toLowerCase().replace(/\s+/g, ''), clinic);
}

// ============================================
// Cherry API keys mapping: clinic label → API key
// ============================================
const cherryKeys: { clinicLabel: string; apiKey: string | null }[] = [
    { clinicLabel: "Bowie", apiKey: "B-x6kkiusEBHOhHDvCnyHBGEQmaNQGhF" },
    { clinicLabel: "Saluda", apiKey: "B-Zo1mMNLAWFamYymtCD7LwuwYNYf794" },
    { clinicLabel: "Cayce", apiKey: null }, // MISSING — needs key from Cherry portal
    { clinicLabel: "West Columbia", apiKey: "B-PFNK86rMbYPeQPVWkJ2hvnH4tlXqR2" },
    { clinicLabel: "Perrysburg", apiKey: "B-65wJoCj8WbGgTUBdDTRzomDmMtxwYE" },
    { clinicLabel: "Lawrenceville", apiKey: "B-r3SsUt6GklmIJCKVseeSpzCF05LnNo" },
    { clinicLabel: "TodaysDentalGV", apiKey: "B-py80YaTCz7URyqJwZPs4Hy8ZMH7qCr" },
    { clinicLabel: "Lexington", apiKey: "B-1Uq4AYy00kpiXeJPqp1UQgyz1F7CqE" },
    { clinicLabel: "Alexandria", apiKey: "B-el19ehktuofdW6JR6ZDDEKxfPeOBrj" },
    { clinicLabel: "Oregon", apiKey: "B-AnOfUR4yWDALCeVEjMyxJqryrhuIOb" },
    { clinicLabel: "Edgewater", apiKey: "B-xSH8GhUxO7GKz2SHVwR8M1WlzDc337" },
    { clinicLabel: "Powell", apiKey: "B-ItRf1Ce6kym3rZ26gDdsYjxQoFuNWr" },
    { clinicLabel: "Concord", apiKey: "B-lwlxNbtrMQW5KZ8HayoQmKA5s8pW3n" },
    { clinicLabel: "New Britain", apiKey: "B-C2glc8iv5vmvJ7K1pZzNelaWWp9aXg" },
    { clinicLabel: "Bloomingdale", apiKey: "B-LoKdAjBo8qjuOf3QNfXYRCQlojjDZu" },
    { clinicLabel: "Winston", apiKey: "B-1tNVx3UkyGzMtey2aacDoQ2QxeWLS9" },
    { clinicLabel: "Vernon Hills", apiKey: "B-ah1RhUdTb4CiakzBCshz4fMtqMHkHi" },
    { clinicLabel: "Meadows", apiKey: "B-cdZdcKAyldzvQ8OTBet7eabeqApq5d" },
    { clinicLabel: "DentistInGreenville", apiKey: "B-43G3nuMWkElJl2NVeKzXlZu4sLqYeF" },
    { clinicLabel: "Louisville", apiKey: "B-SDREdqYkONybLfHEEN7Mdo0TiQulaR" },
    { clinicLabel: "Reno", apiKey: "B-fyIxLSazkvlr8or5OOHAPOacqJohH8" },
    { clinicLabel: "TheRim", apiKey: "B-Qjx9tcBusMOb3pKfcGkc02fH6ecAay" },
    { clinicLabel: "Pearland", apiKey: null }, // MISSING — needs key from Cherry portal
    { clinicLabel: "Austin", apiKey: "B-uiFuuvjZ7cA1dfjhmTGDxBeMydjzIy" },
    { clinicLabel: "Stillwater", apiKey: "B-RFcBsyZsG7gwvnnvEMpQuyVeMpkLYz" },
    { clinicLabel: "Centennial", apiKey: "B-FtdhmCehpLKsS2kxRCzWOJuD2KG0b7" },
    { clinicLabel: "Creek Crossing", apiKey: "B-N4uVh04HINKnVLNRTj6DNRvxdy2xwW" },
];

// ============================================
// Explicit mapping from Cherry label → clinicId (from clinic-config.json)
// This resolves ambiguity for duplicate cities and non-standard labels
// ============================================
const clinicLabelToId: Record<string, string> = {
    "bowie": "dentistinbowie",
    "saluda": "dentistatsaludapointe",
    "cayce": "todaysdentalcayce",
    "west columbia": "todaysdentalwestcolumbia",
    "perrysburg": "dentistinperrysburg",
    "lawrenceville": "lawrencevilledentistry",
    "todaysdentalgv": "todaysdentalgreenville",      // "TodaysDentalGV" = Todays Dental Greenville (1530 Poinsett Hwy)
    "lexington": "todaysdentallexington",
    "alexandria": "todaysdentalalexandria",
    "oregon": "dentistinoregonoh",
    "edgewater": "dentistinedgewater",           // Fixed: was "dentistinedgewatermd"
    "powell": "dentistinpowellohio",
    "concord": "dentistinconcord",
    "new britain": "dentistinnewbritain",
    "bloomingdale": "dentistinbloomingdale",        // Fixed: was "dentistinbloomingdaleil"
    "winston": "dentistinwinston-salem",
    "vernon hills": "dentistinvernonhills",
    "meadows": "meadowsdentalcare",            // Fixed: was "themeadowsdentalcare"
    "dentistingreenville": "dentistingreenville",          // "NewGreenVille" = Dentist in Greenville (4 Market Point Dr)
    "louisville": "dentistinlouisville",
    "reno": "renodentalcareandorthodontics",
    "therim": "therimdentalcare",             // The Rim Dental Care (San Antonio)
    "pearland": "pearlanddentalcare",           // Fixed: was "todaysdentalpearland"
    "austin": "dentistinaustin",              // Fixed: was "dentistinaustintx"
    "stillwater": "dentistinstillwater",          // Fixed: was "stillwaterdentalcareandortho"
    "centennial": "dentistincentennial",
    "creek crossing": "creekcrossingdentalcare",
};

function resolveClinicId(label: string): string | undefined {
    const normalized = label.toLowerCase().trim();
    // 1. Try explicit mapping first
    if (clinicLabelToId[normalized]) {
        return clinicLabelToId[normalized];
    }
    // 2. Try matching directly as a clinicId
    if (configById.has(normalized)) {
        return normalized;
    }
    // 3. Try matching by city name
    const cityKey = normalized.replace(/\s+/g, '');
    const byCity = configByCity.get(cityKey);
    if (byCity) {
        return byCity.clinicId;
    }
    return undefined;
}

async function getExistingClinicIds(): Promise<string[]> {
    try {
        const result = await dynamo.send(new ScanCommand({
            TableName: TABLE_NAME,
            ProjectionExpression: 'clinicId',
        }));
        return (result.Items || []).map(item => item.clinicId?.S || '').filter(Boolean);
    } catch (err: any) {
        console.error('Error scanning table:', err.message);
        return [];
    }
}

async function updateCherryKey(clinicId: string, apiKey: string): Promise<boolean> {
    try {
        await dynamo.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: {
                clinicId: { S: clinicId },
            },
            UpdateExpression: 'SET cherryApiKey = :key, updatedAt = :ts',
            ExpressionAttributeValues: {
                ':key': { S: apiKey },
                ':ts': { S: new Date().toISOString() },
            },
        }));
        return true;
    } catch (err: any) {
        console.error(`  ❌ Error updating ${clinicId}: ${err.message}`);
        return false;
    }
}

async function main() {
    console.log('=== Cherry API Key Storage Script ===');
    console.log(`Table: ${TABLE_NAME}`);
    console.log(`Region: ${REGION}`);
    console.log(`Loaded ${clinicConfig.length} clinics from clinic-config.json`);
    console.log('');

    // Show resolved mappings first (dry-run preview)
    console.log('--- Resolved Mappings ---');
    for (const entry of cherryKeys) {
        const clinicId = resolveClinicId(entry.clinicLabel);
        const status = !entry.apiKey ? '⏭️  NO KEY' : clinicId ? `→ ${clinicId}` : '❌ UNMAPPED';
        console.log(`  ${entry.clinicLabel.padEnd(25)} ${status}`);
    }
    console.log('');

    // 1. Get existing clinic IDs from DynamoDB
    console.log('Scanning existing clinic IDs in DynamoDB...');
    const existingIds = await getExistingClinicIds();
    console.log(`Found ${existingIds.length} clinics in table`);
    console.log('');

    // 2. Process each Cherry key
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    const unmapped: string[] = [];

    for (const entry of cherryKeys) {
        const clinicId = resolveClinicId(entry.clinicLabel);

        if (!entry.apiKey) {
            console.log(`⏭️  ${entry.clinicLabel}: SKIPPED (no API key)`);
            skipCount++;
            continue;
        }

        if (!clinicId) {
            console.log(`⚠️  ${entry.clinicLabel}: No clinicId mapping found`);
            unmapped.push(entry.clinicLabel);
            failCount++;
            continue;
        }

        // Verify clinicId exists in clinic-config.json
        if (!configById.has(clinicId.toLowerCase())) {
            console.log(`⚠️  ${entry.clinicLabel} → ${clinicId}: WARNING — clinicId NOT in clinic-config.json!`);
        }

        if (!existingIds.includes(clinicId)) {
            console.log(`⚠️  ${entry.clinicLabel} → ${clinicId}: NOT FOUND in ClinicSecrets table (will create entry)`);
        }

        const success = await updateCherryKey(clinicId, entry.apiKey);
        if (success) {
            console.log(`✅ ${entry.clinicLabel} → ${clinicId}: Cherry API key stored`);
            successCount++;
        } else {
            failCount++;
        }
    }

    // 3. Summary
    console.log('\n=== Summary ===');
    console.log(`✅ Stored: ${successCount}`);
    console.log(`⏭️  Skipped (no key): ${skipCount}`);
    console.log(`❌ Failed: ${failCount}`);
    if (unmapped.length > 0) {
        console.log(`\n⚠️  Unmapped clinic labels (need clinicId mapping):`);
        unmapped.forEach(n => console.log(`  - ${n}`));
    }

    // Show clinics WITHOUT Cherry keys
    const clinicsWithKeys = new Set(
        cherryKeys
            .filter(e => e.apiKey)
            .map(e => resolveClinicId(e.clinicLabel))
            .filter(Boolean)
    );
    const clinicsWithoutKeys = clinicConfig.filter(c => !clinicsWithKeys.has(c.clinicId));
    if (clinicsWithoutKeys.length > 0) {
        console.log(`\n📋 Clinics WITHOUT Cherry API keys (${clinicsWithoutKeys.length}):`);
        clinicsWithoutKeys.forEach(c => console.log(`  - ${c.clinicId} (${c.clinicName})`));
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

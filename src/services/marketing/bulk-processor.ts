import { SQSEvent, SQSHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import {
  ayrshareCreateFullCampaign,
  ayrshareGetLeadForms,
  ayrshareCreateLeadForm,
  FullCampaignParams
} from './ayrshare-client';
import { 
  getClinicConfig,
  getClinicSecrets,
  ClinicConfig
} from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const META_BULK_JOBS_TABLE = process.env.META_BULK_JOBS_TABLE || 'MetaBulkJobs';
const META_BULK_RESULTS_TABLE = process.env.META_BULK_RESULTS_TABLE || 'MetaBulkResults';
const META_CAMPAIGNS_TABLE = process.env.META_CAMPAIGNS_TABLE || 'MetaAdCampaigns';
const META_LEAD_FORMS_TABLE = process.env.META_LEAD_FORMS_TABLE || 'MetaLeadForms';
const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

// Batch size for parallel processing
const BATCH_SIZE = 3;

// Helper to generate IDs
function generateId(prefix: string): string {
  return `${prefix}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get Ayrshare profile key for a clinic
async function getProfileKey(clinicId: string): Promise<string | null> {
  // First check DynamoDB profiles table
  const dbRes = await ddb.send(new GetCommand({
    TableName: PROFILES_TABLE,
    Key: { clinicId }
  }));

  if (dbRes.Item?.ayrshareProfileKey) {
    return dbRes.Item.ayrshareProfileKey;
  }

  // Fallback to secrets helper
  const secrets = await getClinicSecrets(clinicId);
  return secrets?.ayrshareProfileKey || null;
}

// Template variable replacement
function replaceVariables(template: any, clinicConfig: ClinicConfig): any {
  const variables: Record<string, string> = {
    '{{clinicId}}': clinicConfig.clinicId || '',
    '{{clinicName}}': clinicConfig.clinicName || '',
    '{{clinicCity}}': clinicConfig.clinicCity || '',
    '{{clinicState}}': clinicConfig.clinicState || '',
    '{{clinicPhone}}': clinicConfig.clinicPhone || clinicConfig.phoneNumber || '',
    '{{clinicEmail}}': clinicConfig.clinicEmail || '',
    '{{clinicAddress}}': clinicConfig.clinicAddress || '',
    '{{websiteLink}}': clinicConfig.websiteLink || '',
    '{{scheduleUrl}}': clinicConfig.scheduleUrl || '',
    '{{mapsUrl}}': clinicConfig.mapsUrl || '',
    '{{phoneNumber}}': clinicConfig.phoneNumber || '',
    '{{currentYear}}': new Date().getFullYear().toString(),
    '{{currentMonth}}': new Date().toLocaleString('en-US', { month: 'long' })
  };

  const replaceInString = (str: string): string => {
    if (!str) return str;
    let result = str;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      result = result.replace(regex, value);
    }
    return result;
  };

  const replaceInObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return replaceInString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => replaceInObject(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = replaceInObject(value);
      }
      return result;
    }
    return obj;
  };

  return replaceInObject(template);
}

// Build targeting with clinic location
function buildTargeting(templateTargeting: any, clinicConfig: ClinicConfig): any {
  return {
    ageMin: templateTargeting?.ageMin || 25,
    ageMax: templateTargeting?.ageMax || 55,
    genders: templateTargeting?.genders || [1, 2],
    locations: templateTargeting?.location === 'AUTO' || !templateTargeting?.locations?.length
      ? [{
          city: clinicConfig.clinicCity,
          state: clinicConfig.clinicState,
          country: 'US',
          radius: templateTargeting?.locationRadius || 25
        }]
      : templateTargeting.locations,
    interests: templateTargeting?.interests || []
  };
}

// Get or create lead form for clinic
async function getOrCreateLeadForm(
  clinicId: string,
  clinicConfig: ClinicConfig,
  profileKey: string
): Promise<string | null> {
  // Check for existing lead form in database
  const existingForms = await ddb.send(new QueryCommand({
    TableName: META_LEAD_FORMS_TABLE,
    IndexName: 'clinicId-index',
    KeyConditionExpression: 'clinicId = :clinicId',
    ExpressionAttributeValues: { ':clinicId': clinicId },
    Limit: 1
  }));

  if (existingForms.Items && existingForms.Items.length > 0) {
    console.log(`[${clinicId}] Using existing lead form: ${existingForms.Items[0].metaFormId}`);
    return existingForms.Items[0].metaFormId;
  }

  // Try to get from Ayrshare
  try {
    const ayrshareResult = await ayrshareGetLeadForms(API_KEY, profileKey);
    if (ayrshareResult.forms && ayrshareResult.forms.length > 0) {
      const form = ayrshareResult.forms[0];
      // Store in database
      const formId = generateId('form');
      await ddb.send(new PutCommand({
        TableName: META_LEAD_FORMS_TABLE,
        Item: {
          formId,
          clinicId,
          metaFormId: form.id,
          name: form.name,
          questions: form.questions || [],
          leadsCollected: 0,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      }));
      console.log(`[${clinicId}] Found existing Ayrshare form: ${form.id}`);
      return form.id;
    }
  } catch (err) {
    console.warn(`[${clinicId}] Could not get existing forms:`, err);
  }

  // Create new lead form
  try {
    console.log(`[${clinicId}] Creating new lead form...`);
    const formResponse = await ayrshareCreateLeadForm(API_KEY, profileKey, {
      name: `${clinicConfig.clinicName} - Lead Form`,
      questions: [
        { type: 'FULL_NAME', key: 'full_name', label: 'Full Name', required: true },
        { type: 'EMAIL', key: 'email', label: 'Email Address', required: true },
        { type: 'PHONE', key: 'phone_number', label: 'Phone Number', required: true }
      ],
      privacyPolicy: {
        url: `${clinicConfig.websiteLink || 'https://example.com'}/privacy`,
        text: 'By submitting this form, you agree to our privacy policy.'
      }
    });

    // Store in database
    const formId = generateId('form');
    await ddb.send(new PutCommand({
      TableName: META_LEAD_FORMS_TABLE,
      Item: {
        formId,
        clinicId,
        metaFormId: formResponse.id,
        name: `${clinicConfig.clinicName} - Lead Form`,
        questions: [
          { type: 'FULL_NAME', key: 'full_name', label: 'Full Name', required: true },
          { type: 'EMAIL', key: 'email', label: 'Email Address', required: true },
          { type: 'PHONE', key: 'phone_number', label: 'Phone Number', required: true }
        ],
        leadsCollected: 0,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }));

    console.log(`[${clinicId}] Lead form created: ${formResponse.id}`);
    return formResponse.id;
  } catch (err) {
    console.error(`[${clinicId}] Failed to create lead form:`, err);
    return null;
  }
}

// Process a single clinic
async function processClinic(
  bulkJobId: string,
  template: any,
  clinicId: string
): Promise<void> {
  const resultId = generateId('result');
  const now = new Date().toISOString();

  try {
    console.log(`[${clinicId}] Starting processing...`);

    // 1. Load clinic config
    const clinicConfig = await getClinicConfig(clinicId);
    if (!clinicConfig) {
      throw new Error(`Clinic config not found: ${clinicId}`);
    }

    // 2. Get Ayrshare profile key
    const profileKey = await getProfileKey(clinicId);
    if (!profileKey) {
      throw new Error(`Clinic not connected to Ayrshare: ${clinicId}`);
    }

    // 3. Create result record as PROCESSING
    await ddb.send(new PutCommand({
      TableName: META_BULK_RESULTS_TABLE,
      Item: {
        resultId,
        bulkJobId,
        clinicId,
        clinicName: clinicConfig.clinicName,
        status: 'PROCESSING',
        createdAt: now
      }
    }));

    // 4. Replace template variables
    const personalizedTemplate = replaceVariables(template, clinicConfig);

    // 5. Build targeting with clinic location
    const targeting = buildTargeting(personalizedTemplate.targeting, clinicConfig);

    // 6. Get or create lead form if needed
    let leadFormId: string | undefined;
    if (personalizedTemplate.destination?.type === 'LEAD_FORM') {
      if (personalizedTemplate.destination?.useClinicForms) {
        leadFormId = await getOrCreateLeadForm(clinicId, clinicConfig, profileKey) || undefined;
      } else {
        leadFormId = personalizedTemplate.destination?.leadFormId;
      }
    }

    console.log(`[${clinicId}] Creating campaign: ${personalizedTemplate.campaignName}`);

    // 7. Build full campaign params
    const campaignParams: FullCampaignParams = {
      campaignName: personalizedTemplate.campaignName,
      objective: personalizedTemplate.objective || 'LEAD_GENERATION',
      budgetType: personalizedTemplate.budgetType || 'DAILY',
      dailyBudget: personalizedTemplate.dailyBudget || 50,
      startDate: personalizedTemplate.startDate || new Date().toISOString().split('T')[0],
      endDate: personalizedTemplate.endDate,
      targeting,
      identity: {
        facebookPageId: personalizedTemplate.identity?.facebookPageId,
        instagramAccountId: personalizedTemplate.identity?.instagramAccountId,
        adFormat: personalizedTemplate.identity?.adFormat || 'SINGLE_IMAGE'
      },
      destination: {
        type: personalizedTemplate.destination?.type || 'LEAD_FORM',
        leadFormId,
        websiteUrl: personalizedTemplate.destination?.websiteUrl
      },
      creative: {
        imageUrl: personalizedTemplate.creative?.imageUrl || personalizedTemplate.creative?.mediaUrl,
        primaryText: personalizedTemplate.creative?.primaryText,
        headline: personalizedTemplate.creative?.headline,
        description: personalizedTemplate.creative?.description,
        callToAction: personalizedTemplate.creative?.callToAction || 'SIGN_UP'
      },
      tracking: personalizedTemplate.tracking
    };

    // 8. Create campaign via Ayrshare
    const result = await ayrshareCreateFullCampaign(API_KEY, profileKey, campaignParams);

    // 9. Store campaign in database
    const campaignId = generateId('camp');
    await ddb.send(new PutCommand({
      TableName: META_CAMPAIGNS_TABLE,
      Item: {
        campaignId,
        clinicId,
        metaCampaignId: result.campaignId,
        metaAdSetId: result.adSetId,
        metaAdId: result.adId,
        name: personalizedTemplate.campaignName,
        objective: campaignParams.objective,
        dailyBudget: campaignParams.dailyBudget,
        startDate: campaignParams.startDate,
        endDate: campaignParams.endDate,
        status: 'PENDING_REVIEW',
        targeting,
        creative: campaignParams.creative,
        bulkJobId,
        createdAt: now,
        updatedAt: now
      }
    }));

    // 10. Update result to SUCCESS
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_RESULTS_TABLE,
      Key: { resultId },
      UpdateExpression: 'SET #status = :status, campaignId = :campaignId, metaCampaignId = :metaCampaignId, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'SUCCESS',
        ':campaignId': campaignId,
        ':metaCampaignId': result.campaignId,
        ':completedAt': new Date().toISOString()
      }
    }));

    // 11. Increment completed count
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId },
      UpdateExpression: 'SET completedClinics = completedClinics + :inc, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log(`[${clinicId}] ✅ Successfully completed!`);
  } catch (error: any) {
    console.error(`[${clinicId}] ❌ Failed:`, error);

    // Update result to FAILED
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_RESULTS_TABLE,
      Key: { resultId },
      UpdateExpression: 'SET #status = :status, #error = :error, completedAt = :completedAt',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':error': {
          code: error.code || 'PROCESSING_ERROR',
          message: error.message,
          details: error.response?.data || error.stack?.substring(0, 500)
        },
        ':completedAt': new Date().toISOString()
      }
    }));

    // Increment failed count
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId },
      UpdateExpression: 'SET failedClinics = failedClinics + :inc, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':updatedAt': new Date().toISOString()
      }
    }));
  }
}

// Process bulk job with batched parallel execution
async function processBulkJob(bulkJobId: string): Promise<void> {
  try {
    console.log(`Starting bulk job: ${bulkJobId}`);

    // 1. Get job details
    const jobResult = await ddb.send(new GetCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId }
    }));

    const job = jobResult.Item;
    if (!job) {
      throw new Error(`Job not found: ${bulkJobId}`);
    }

    // 2. Update status to PROCESSING
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId },
      UpdateExpression: 'SET #status = :status, processingClinics = :processingClinics, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'PROCESSING',
        ':processingClinics': job.selectedClinicIds.length,
        ':updatedAt': new Date().toISOString()
      }
    }));

    // 3. Process clinics in batches
    const clinicIds: string[] = job.selectedClinicIds;
    console.log(`Processing ${clinicIds.length} clinics in batches of ${BATCH_SIZE}...`);

    for (let i = 0; i < clinicIds.length; i += BATCH_SIZE) {
      const batch = clinicIds.slice(i, i + BATCH_SIZE);
      
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(', ')}`);

      // Process this batch in parallel
      await Promise.allSettled(
        batch.map(clinicId => processClinic(bulkJobId, job.template, clinicId))
      );

      // Small delay between batches to respect rate limits
      if (i + BATCH_SIZE < clinicIds.length) {
        console.log('Waiting 3 seconds before next batch...');
        await sleep(3000);
      }
    }

    // 4. Get final job state
    const finalJobResult = await ddb.send(new GetCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId }
    }));

    const finalJob = finalJobResult.Item;
    const finalStatus = finalJob?.failedClinics > 0 
      ? (finalJob?.completedClinics > 0 ? 'PARTIAL_SUCCESS' : 'FAILED')
      : 'COMPLETED';

    // 5. Update final status
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId },
      UpdateExpression: 'SET #status = :status, processingClinics = :zero, completedAt = :completedAt, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': finalStatus,
        ':zero': 0,
        ':completedAt': new Date().toISOString(),
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log(`Bulk job completed: ${bulkJobId} - ${finalStatus}`);
  } catch (error: any) {
    console.error(`Bulk job error: ${bulkJobId}`, error);
    
    await ddb.send(new UpdateCommand({
      TableName: META_BULK_JOBS_TABLE,
      Key: { bulkJobId },
      UpdateExpression: 'SET #status = :status, #error = :error, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: {
        ':status': 'FAILED',
        ':error': error.message,
        ':updatedAt': new Date().toISOString()
      }
    }));
  }
}

// SQS Handler
export const handler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  console.log(`Processing ${event.Records.length} SQS messages`);

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const { bulkJobId } = body;

      if (bulkJobId) {
        await processBulkJob(bulkJobId);
      } else {
        console.warn('No bulkJobId in message:', body);
      }
    } catch (error) {
      console.error('Error processing SQS message:', error);
      throw error; // Re-throw to let SQS handle retries
    }
  }
};

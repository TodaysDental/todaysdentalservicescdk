import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import {
  ayrshareBoostPost,
  ayrshareCreateAdCampaign,
  ayrshareGetAdCampaigns,
  ayrshareGetAdCampaign,
  ayrshareUpdateAdCampaign,
  ayrshareDeleteAdCampaign,
  ayrshareGetAdAnalytics,
  ayrshareGetAdAccount,
  ayrshareCreateLeadForm,
  ayrshareGetLeadForms,
  ayrshareGetLeads,
  ayrshareCreateFullCampaign,
  BoostPostParams,
  CreateAdCampaignParams,
  CreateLeadFormParams,
  FullCampaignParams
} from './ayrshare-client';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { 
  getClinicConfig as getClinicConfigFromDynamo, 
  getClinicSecrets,
  ClinicConfig 
} from '../../shared/utils/secrets-helper';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});
const sqs = new SQSClient({});

const PROFILES_TABLE = process.env.MARKETING_PROFILES_TABLE!;
const POSTS_TABLE = process.env.MARKETING_POSTS_TABLE!;
const API_KEY = process.env.AYRSHARE_API_KEY!;

// New Meta Ads tables
const META_AD_DRAFTS_TABLE = process.env.META_AD_DRAFTS_TABLE || 'MetaAdDrafts';
const META_LEAD_FORMS_TABLE = process.env.META_LEAD_FORMS_TABLE || 'MetaLeadForms';
const META_LEADS_TABLE = process.env.META_LEADS_TABLE || 'MetaLeads';
const META_BULK_JOBS_TABLE = process.env.META_BULK_JOBS_TABLE || 'MetaBulkJobs';
const META_BULK_RESULTS_TABLE = process.env.META_BULK_RESULTS_TABLE || 'MetaBulkResults';
const META_SCHEDULED_CAMPAIGNS_TABLE = process.env.META_SCHEDULED_CAMPAIGNS_TABLE || 'MetaScheduledCampaigns';
const META_CAMPAIGNS_TABLE = process.env.META_CAMPAIGNS_TABLE || 'MetaAdCampaigns';
const BULK_PROCESSOR_QUEUE_URL = process.env.BULK_PROCESSOR_QUEUE_URL || '';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface CampaignDraft {
  draftId: string;
  userId: string;
  clinicId: string;
  jobName: string;
  currentStep: number;
  totalSteps: number;
  data: {
    step1?: any; // Campaign details
    step2?: any; // Audience targeting
    step3?: any; // Identity
    step4?: any; // Destination
    step5?: any; // Creative
    step6?: any; // Tracking
    step7?: any; // Preview
    step8?: any; // Review
  };
  lastModified: string;
  createdAt: string;
}

interface LeadFormQuestion {
  type: 'FULL_NAME' | 'EMAIL' | 'PHONE' | 'CUSTOM';
  key: string;
  label: string;
  required: boolean;
  fieldType?: 'TEXT' | 'MULTIPLE_CHOICE' | 'DROPDOWN';
  options?: { value: string; label: string }[];
}

interface MetaLeadForm {
  formId: string;
  clinicId: string;
  metaFormId: string;
  name: string;
  questions: LeadFormQuestion[];
  privacyPolicy?: { url: string; text: string };
  thankYouPage?: { title: string; body: string };
  leadsCollected: number;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  createdAt: string;
  updatedAt: string;
}

interface MetaLead {
  leadId: string;
  formId: string;
  clinicId: string;
  campaignId?: string;
  metaLeadId: string;
  fieldData: { name: string; values: string[] }[];
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  source: string;
  createdAt: string;
  contactedAt?: string;
}

interface ScheduledCampaign {
  scheduledId: string;
  clinicId: string;
  userId: string;
  scheduledStartDate: string;
  campaignData: any;
  status: 'SCHEDULED' | 'PUBLISHED' | 'CANCELLED' | 'FAILED';
  campaignId?: string;
  createdAt: string;
  publishedAt?: string;
}

interface BulkPublishJob {
  bulkJobId: string;
  userId: string;
  jobName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL_SUCCESS';
  totalClinics: number;
  completedClinics: number;
  failedClinics: number;
  processingClinics: number;
  template: any;
  selectedClinicIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// Helper to generate IDs
function generateId(prefix: string): string {
  return `${prefix}_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
}

// Cache for clinic config lookups
const clinicConfigCache: Record<string, ClinicConfig | null> = {};

// Helper to get clinic config from DynamoDB (cached)
async function getClinicConfigCached(clinicId: string): Promise<ClinicConfig | null> {
  if (clinicConfigCache[clinicId] !== undefined) {
    return clinicConfigCache[clinicId];
  }
  const config = await getClinicConfigFromDynamo(clinicId);
  clinicConfigCache[clinicId] = config;
  return config;
}

// Helper to get Ayrshare profile key for a clinic
async function getProfileKey(clinicId: string): Promise<string | null> {
  // First check DynamoDB profiles table
  const dbRes = await ddb.send(new GetCommand({
    TableName: PROFILES_TABLE,
    Key: { clinicId }
  }));

  if (dbRes.Item?.ayrshareProfileKey) {
    return dbRes.Item.ayrshareProfileKey;
  }

  // Fallback to secrets helper (ClinicSecrets table)
  const secrets = await getClinicSecrets(clinicId);
  return secrets?.ayrshareProfileKey || null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'PUT', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;

    // ---------------------------------------------------------
    // POST /ads/{clinicId}/boost - Boost an existing post
    // ---------------------------------------------------------
    if (path.includes('/boost') && method === 'POST') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { postId, budget, durationDays, targetAudience, objective } = body;

      if (!postId || !budget || !durationDays) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'postId, budget, and durationDays are required' 
          })
        };
      }

      const boostParams: BoostPostParams = {
        postId,
        budget: Number(budget),
        durationDays: Number(durationDays),
        targetAudience,
        objective
      };

      const result = await ayrshareBoostPost(API_KEY, profileKey, boostParams);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Post boosted successfully',
          clinicId,
          postId,
          budget: boostParams.budget,
          durationDays: boostParams.durationDays,
          boostResult: result
        })
      };
    }

    // ---------------------------------------------------------
    // POST /ads/{clinicId}/campaigns - Create a new ad campaign
    // ---------------------------------------------------------
    if (path.endsWith('/campaigns') && method === 'POST') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { name, objective, budget, startDate, endDate, platforms, creative, targeting } = body;

      if (!name || !objective || !budget || !startDate || !platforms || !creative) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'name, objective, budget, startDate, platforms, and creative are required' 
          })
        };
      }

      const campaignParams: CreateAdCampaignParams = {
        name,
        objective,
        budget: Number(budget),
        startDate,
        endDate,
        platforms,
        creative,
        targeting
      };

      const result = await ayrshareCreateAdCampaign(API_KEY, profileKey, campaignParams);

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Ad campaign created successfully',
          clinicId,
          campaign: result
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/campaigns - Get all campaigns
    // ---------------------------------------------------------
    if (path.endsWith('/campaigns') && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const status = event.queryStringParameters?.status as 'active' | 'paused' | 'completed' | 'all' | undefined;
      const limit = event.queryStringParameters?.limit ? Number(event.queryStringParameters.limit) : undefined;

      const result = await ayrshareGetAdCampaigns(API_KEY, profileKey, { status, limit });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          campaigns: result.campaigns || result,
          total: Array.isArray(result) ? result.length : result.campaigns?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/campaigns/{campaignId} - Get single campaign
    // ---------------------------------------------------------
    if (path.match(/\/campaigns\/[^\/]+$/) && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const campaignId = event.pathParameters?.campaignId;
      if (!campaignId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'campaignId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const result = await ayrshareGetAdCampaign(API_KEY, profileKey, campaignId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          campaign: result
        })
      };
    }

    // ---------------------------------------------------------
    // PUT /ads/{clinicId}/campaigns/{campaignId} - Update campaign
    // ---------------------------------------------------------
    if (path.match(/\/campaigns\/[^\/]+$/) && method === 'PUT') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const campaignId = event.pathParameters?.campaignId;
      if (!campaignId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'campaignId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { status, budget, endDate } = body;

      const result = await ayrshareUpdateAdCampaign(API_KEY, profileKey, campaignId, {
        status,
        budget: budget ? Number(budget) : undefined,
        endDate
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Campaign updated successfully',
          clinicId,
          campaignId,
          campaign: result
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /ads/{clinicId}/campaigns/{campaignId} - Delete campaign
    // ---------------------------------------------------------
    if (path.match(/\/campaigns\/[^\/]+$/) && method === 'DELETE') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const campaignId = event.pathParameters?.campaignId;
      if (!campaignId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'campaignId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      await ayrshareDeleteAdCampaign(API_KEY, profileKey, campaignId);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Campaign deleted successfully',
          clinicId,
          campaignId
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/analytics - Get ad analytics
    // ---------------------------------------------------------
    if (path.includes('/analytics') && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const campaignId = event.queryStringParameters?.campaignId;
      const postId = event.queryStringParameters?.postId;
      const startDate = event.queryStringParameters?.startDate;
      const endDate = event.queryStringParameters?.endDate;

      const result = await ayrshareGetAdAnalytics(API_KEY, profileKey, {
        campaignId,
        postId,
        startDate,
        endDate
      });

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          analytics: result
        })
      };
    }

    // ---------------------------------------------------------
    // GET /ads/{clinicId}/account - Get ad account info
    // ---------------------------------------------------------
    if (path.includes('/account') && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const result = await ayrshareGetAdAccount(API_KEY, profileKey);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          account: result
        })
      };
    }

    // =========================================================
    // META ADS DRAFT MANAGEMENT - /meta/ads/drafts
    // =========================================================

    // ---------------------------------------------------------
    // GET /meta/ads/drafts - Get all drafts for user
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/drafts\/?$/) && method === 'GET') {
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';
      
      const result = await ddb.send(new QueryCommand({
        TableName: META_AD_DRAFTS_TABLE,
        IndexName: 'userId-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ScanIndexForward: false // Most recent first
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          drafts: result.Items || [],
          total: result.Items?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // POST /meta/ads/drafts - Create new draft
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/drafts\/?$/) && method === 'POST') {
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';
      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      const draft: CampaignDraft = {
        draftId: generateId('draft'),
        userId,
        clinicId: body.clinicId || '',
        jobName: body.jobName || 'Untitled Campaign',
        currentStep: body.currentStep || 1,
        totalSteps: 8,
        data: body.data || {},
        lastModified: now,
        createdAt: now
      };

      await ddb.send(new PutCommand({
        TableName: META_AD_DRAFTS_TABLE,
        Item: draft
      }));

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Draft created successfully',
          draft
        })
      };
    }

    // ---------------------------------------------------------
    // GET /meta/ads/drafts/{draftId} - Get single draft
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/drafts\/[^\/]+$/) && method === 'GET') {
      const draftId = event.pathParameters?.draftId;
      if (!draftId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'draftId required' })
        };
      }

      const result = await ddb.send(new GetCommand({
        TableName: META_AD_DRAFTS_TABLE,
        Key: { draftId }
      }));

      if (!result.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Draft not found' })
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          draft: result.Item
        })
      };
    }

    // ---------------------------------------------------------
    // PUT /meta/ads/drafts/{draftId} - Update draft (auto-save)
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/drafts\/[^\/]+$/) && method === 'PUT') {
      const draftId = event.pathParameters?.draftId;
      if (!draftId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'draftId required' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      // Build update expression dynamically
      const updateExpressions: string[] = ['lastModified = :lastModified'];
      const expressionValues: Record<string, any> = { ':lastModified': now };

      if (body.currentStep !== undefined) {
        updateExpressions.push('currentStep = :currentStep');
        expressionValues[':currentStep'] = body.currentStep;
      }
      if (body.jobName !== undefined) {
        updateExpressions.push('jobName = :jobName');
        expressionValues[':jobName'] = body.jobName;
      }
      if (body.clinicId !== undefined) {
        updateExpressions.push('clinicId = :clinicId');
        expressionValues[':clinicId'] = body.clinicId;
      }
      if (body.data !== undefined) {
        updateExpressions.push('#data = :data');
        expressionValues[':data'] = body.data;
      }

      await ddb.send(new UpdateCommand({
        TableName: META_AD_DRAFTS_TABLE,
        Key: { draftId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: body.data !== undefined ? { '#data': 'data' } : undefined
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Draft updated successfully',
          draftId,
          lastModified: now
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /meta/ads/drafts/{draftId} - Delete draft
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/drafts\/[^\/]+$/) && method === 'DELETE') {
      const draftId = event.pathParameters?.draftId;
      if (!draftId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'draftId required' })
        };
      }

      await ddb.send(new DeleteCommand({
        TableName: META_AD_DRAFTS_TABLE,
        Key: { draftId }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Draft deleted successfully',
          draftId
        })
      };
    }

    // =========================================================
    // META ADS LEAD FORMS - /meta/ads/{clinicId}/lead-forms
    // =========================================================

    // ---------------------------------------------------------
    // GET /meta/ads/{clinicId}/lead-forms - Get clinic lead forms
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/lead-forms\/?$/) && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      // Get from local database
      const dbResult = await ddb.send(new QueryCommand({
        TableName: META_LEAD_FORMS_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': clinicId }
      }));

      // Optionally sync with Ayrshare
      const profileKey = await getProfileKey(clinicId);
      let ayrshareFormsRefreshed = false;
      if (profileKey && event.queryStringParameters?.refresh === 'true') {
        try {
          const ayrshareResult = await ayrshareGetLeadForms(API_KEY, profileKey);
          ayrshareFormsRefreshed = true;
          // Could sync forms here if needed
        } catch (err) {
          console.warn('Failed to refresh from Ayrshare:', err);
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          forms: dbResult.Items || [],
          total: dbResult.Items?.length || 0,
          ayrshareRefreshed: ayrshareFormsRefreshed
        })
      };
    }

    // ---------------------------------------------------------
    // POST /meta/ads/{clinicId}/lead-forms - Create lead form
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/lead-forms\/?$/) && method === 'POST') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Clinic profile not found' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { name, questions, privacyPolicy, thankYouPage } = body;

      if (!name || !questions || questions.length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'name and questions are required' 
          })
        };
      }

      // Create in Ayrshare/Meta
      const ayrshareParams: CreateLeadFormParams = {
        name,
        questions,
        privacyPolicy,
        thankYouPage
      };

      const ayrshareResult = await ayrshareCreateLeadForm(API_KEY, profileKey, ayrshareParams);

      // Store in DynamoDB
      const now = new Date().toISOString();
      const formId = generateId('form');
      const leadForm: MetaLeadForm = {
        formId,
        clinicId,
        metaFormId: ayrshareResult.id || ayrshareResult.formId || formId,
        name,
        questions,
        privacyPolicy,
        thankYouPage,
        leadsCollected: 0,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };

      await ddb.send(new PutCommand({
        TableName: META_LEAD_FORMS_TABLE,
        Item: leadForm
      }));

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Lead form created successfully',
          form: leadForm
        })
      };
    }

    // ---------------------------------------------------------
    // GET /meta/ads/{clinicId}/lead-forms/{formId}/leads - Get leads
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/lead-forms\/[^\/]+\/leads/) && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const formId = event.pathParameters?.formId;
      if (!formId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'formId required' })
        };
      }

      // Query leads from DynamoDB
      const result = await ddb.send(new QueryCommand({
        TableName: META_LEADS_TABLE,
        IndexName: 'formId-index',
        KeyConditionExpression: 'formId = :formId',
        ExpressionAttributeValues: { ':formId': formId },
        ScanIndexForward: false,
        Limit: event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : 50
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          formId,
          leads: result.Items || [],
          total: result.Items?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // GET /meta/ads/{clinicId}/leads - Get all leads for clinic
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/leads\/?$/) && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const status = event.queryStringParameters?.status;
      const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : 50;

      let filterExpression = undefined;
      let expressionValues: Record<string, any> = { ':clinicId': clinicId };

      if (status) {
        filterExpression = '#status = :status';
        expressionValues[':status'] = status;
      }

      const result = await ddb.send(new QueryCommand({
        TableName: META_LEADS_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
        ScanIndexForward: false,
        Limit: limit
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          leads: result.Items || [],
          total: result.Items?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // PUT /meta/ads/{clinicId}/leads/{leadId} - Update lead status
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/leads\/[^\/]+$/) && method === 'PUT') {
      const leadId = event.pathParameters?.leadId;
      if (!leadId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'leadId required' })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      const updateExpressions: string[] = [];
      const expressionValues: Record<string, any> = {};

      if (body.status) {
        updateExpressions.push('#status = :status');
        expressionValues[':status'] = body.status;
      }
      if (body.status === 'contacted') {
        updateExpressions.push('contactedAt = :contactedAt');
        expressionValues[':contactedAt'] = now;
      }

      if (updateExpressions.length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'No fields to update' })
        };
      }

      await ddb.send(new UpdateCommand({
        TableName: META_LEADS_TABLE,
        Key: { leadId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: { '#status': 'status' }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Lead updated successfully',
          leadId
        })
      };
    }

    // =========================================================
    // FULL CAMPAIGN PUBLISH - /meta/ads/{clinicId}/campaigns/publish
    // =========================================================

    // ---------------------------------------------------------
    // POST /meta/ads/{clinicId}/campaigns/publish - Full 8-step publish
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/campaigns\/publish/) && method === 'POST') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      const profileKey = await getProfileKey(clinicId);
      if (!profileKey) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'Clinic not connected to Meta Ads. Please connect in Settings.' 
          })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';
      const now = new Date().toISOString();

      // Validate required fields
      const { campaignName, objective, budgetType, dailyBudget, startDate, targeting, identity, destination, creative } = body;
      
      if (!campaignName || !objective || !dailyBudget || !startDate || !creative) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Missing required fields: campaignName, objective, dailyBudget, startDate, creative'
          })
        };
      }

      // Build full campaign params for Ayrshare
      const fullCampaignParams: FullCampaignParams = {
        campaignName,
        objective,
        budgetType: budgetType || 'DAILY',
        dailyBudget: Number(dailyBudget),
        startDate,
        endDate: body.endDate,
        targeting: {
          ageMin: targeting?.ageMin || 18,
          ageMax: targeting?.ageMax || 65,
          genders: targeting?.genders || [1, 2],
          locations: targeting?.locations || [],
          interests: targeting?.interests || []
        },
        identity: {
          facebookPageId: identity?.facebookPageId,
          instagramAccountId: identity?.instagramAccountId,
          adFormat: identity?.adFormat || 'SINGLE_IMAGE'
        },
        destination: {
          type: destination?.type || 'LEAD_FORM',
          leadFormId: destination?.leadFormId,
          websiteUrl: destination?.websiteUrl
        },
        creative: {
          imageUrl: creative.imageUrl,
          primaryText: creative.primaryText,
          headline: creative.headline,
          description: creative.description,
          callToAction: creative.callToAction || 'SIGN_UP'
        },
        tracking: body.tracking
      };

      // Create campaign via Ayrshare
      const ayrshareResult = await ayrshareCreateFullCampaign(API_KEY, profileKey, fullCampaignParams);

      // Store campaign in DynamoDB
      const campaignId = generateId('camp');
      const campaign = {
        campaignId,
        clinicId,
        metaCampaignId: ayrshareResult.campaignId,
        metaAdSetId: ayrshareResult.adSetId,
        metaAdId: ayrshareResult.adId,
        name: campaignName,
        objective,
        budgetType,
        dailyBudget: Number(dailyBudget),
        totalBudget: body.endDate ? 
          Math.ceil((new Date(body.endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) * Number(dailyBudget) 
          : null,
        startDate,
        endDate: body.endDate,
        status: 'PENDING_REVIEW',
        targeting,
        identity,
        destination,
        creative,
        tracking: body.tracking,
        createdBy: userId,
        createdAt: now,
        updatedAt: now
      };

      await ddb.send(new PutCommand({
        TableName: META_CAMPAIGNS_TABLE,
        Item: campaign
      }));

      // Delete draft if provided
      if (body.draftId) {
        try {
          await ddb.send(new DeleteCommand({
            TableName: META_AD_DRAFTS_TABLE,
            Key: { draftId: body.draftId }
          }));
        } catch (err) {
          console.warn('Failed to delete draft:', err);
        }
      }

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Campaign created and submitted to Meta for review',
          data: {
            campaignId,
            metaCampaignId: campaign.metaCampaignId,
            metaAdSetId: campaign.metaAdSetId,
            metaAdId: campaign.metaAdId,
            status: 'PENDING_REVIEW',
            estimatedApprovalTime: '24 hours',
            budget: {
              dailyBudget: campaign.dailyBudget,
              totalBudget: campaign.totalBudget
            },
            createdAt: now
          }
        })
      };
    }

    // =========================================================
    // BULK JOBS - /meta/ads/bulk/jobs
    // =========================================================

    // ---------------------------------------------------------
    // POST /meta/ads/bulk/jobs - Create bulk publish job
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/bulk\/jobs\/?$/) && method === 'POST') {
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';
      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      const { jobName, selectedClinicIds, template } = body;

      if (!selectedClinicIds || selectedClinicIds.length === 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'selectedClinicIds is required and must not be empty' 
          })
        };
      }

      if (!template) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'template is required' })
        };
      }

      const bulkJobId = generateId('bulk');
      const bulkJob: BulkPublishJob = {
        bulkJobId,
        userId,
        jobName: jobName || 'Bulk Campaign',
        status: 'PENDING',
        totalClinics: selectedClinicIds.length,
        completedClinics: 0,
        failedClinics: 0,
        processingClinics: 0,
        template,
        selectedClinicIds,
        createdAt: now,
        updatedAt: now
      };

      await ddb.send(new PutCommand({
        TableName: META_BULK_JOBS_TABLE,
        Item: bulkJob
      }));

      // Queue job for processing
      if (BULK_PROCESSOR_QUEUE_URL) {
        await sqs.send(new SendMessageCommand({
          QueueUrl: BULK_PROCESSOR_QUEUE_URL,
          MessageBody: JSON.stringify({ bulkJobId }),
          MessageGroupId: 'bulk-jobs'
        }));
      }

      return {
        statusCode: 202,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Bulk job created and queued for processing',
          data: {
            bulkJobId,
            jobName: bulkJob.jobName,
            status: 'PENDING',
            totalClinics: bulkJob.totalClinics,
            selectedClinicIds,
            estimatedCompletionTime: `${Math.ceil(selectedClinicIds.length * 10 / 60)} minutes`,
            createdAt: now
          }
        })
      };
    }

    // ---------------------------------------------------------
    // GET /meta/ads/bulk/jobs - Get all bulk jobs for user
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/bulk\/jobs\/?$/) && method === 'GET') {
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';

      const result = await ddb.send(new QueryCommand({
        TableName: META_BULK_JOBS_TABLE,
        IndexName: 'userId-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ScanIndexForward: false
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          jobs: result.Items || [],
          total: result.Items?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // GET /meta/ads/bulk/jobs/{bulkJobId} - Get bulk job status
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/bulk\/jobs\/[^\/]+$/) && method === 'GET') {
      const bulkJobId = event.pathParameters?.bulkJobId;
      if (!bulkJobId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'bulkJobId required' })
        };
      }

      const jobResult = await ddb.send(new GetCommand({
        TableName: META_BULK_JOBS_TABLE,
        Key: { bulkJobId }
      }));

      if (!jobResult.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Bulk job not found' })
        };
      }

      // Get results for this job
      const resultsResult = await ddb.send(new QueryCommand({
        TableName: META_BULK_RESULTS_TABLE,
        IndexName: 'bulkJobId-index',
        KeyConditionExpression: 'bulkJobId = :bulkJobId',
        ExpressionAttributeValues: { ':bulkJobId': bulkJobId }
      }));

      const job = jobResult.Item as BulkPublishJob;
      const progressPercentage = job.totalClinics > 0 
        ? ((job.completedClinics + job.failedClinics) / job.totalClinics) * 100 
        : 0;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            ...job,
            progressPercentage: Math.round(progressPercentage * 10) / 10,
            results: resultsResult.Items || []
          }
        })
      };
    }

    // =========================================================
    // SCHEDULED CAMPAIGNS - /meta/ads/scheduled
    // =========================================================

    // ---------------------------------------------------------
    // POST /meta/ads/scheduled - Schedule future campaign
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/scheduled\/?$/) && method === 'POST') {
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';
      const body = JSON.parse(event.body || '{}');
      const now = new Date().toISOString();

      const { scheduledStartDate, campaignData, clinicId: scheduledClinicId } = body;

      if (!scheduledStartDate || !campaignData) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'scheduledStartDate and campaignData are required' 
          })
        };
      }

      // Validate scheduled date is in the future
      if (new Date(scheduledStartDate) <= new Date()) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'scheduledStartDate must be in the future' 
          })
        };
      }

      const scheduledId = generateId('sched');
      const scheduledCampaign: ScheduledCampaign = {
        scheduledId,
        clinicId: scheduledClinicId || clinicId || '',
        userId,
        scheduledStartDate,
        campaignData,
        status: 'SCHEDULED',
        createdAt: now
      };

      await ddb.send(new PutCommand({
        TableName: META_SCHEDULED_CAMPAIGNS_TABLE,
        Item: scheduledCampaign
      }));

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Campaign scheduled successfully',
          data: {
            scheduledId,
            scheduledStartDate,
            status: 'SCHEDULED',
            createdAt: now
          }
        })
      };
    }

    // ---------------------------------------------------------
    // GET /meta/ads/scheduled - List scheduled campaigns
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/scheduled\/?$/) && method === 'GET') {
      const userId = event.requestContext?.authorizer?.claims?.sub || event.headers['x-user-id'] || 'anonymous';
      const filterClinicId = event.queryStringParameters?.clinicId;

      let result;
      if (filterClinicId) {
        result = await ddb.send(new QueryCommand({
          TableName: META_SCHEDULED_CAMPAIGNS_TABLE,
          IndexName: 'clinicId-index',
          KeyConditionExpression: 'clinicId = :clinicId',
          ExpressionAttributeValues: { ':clinicId': filterClinicId }
        }));
      } else {
        result = await ddb.send(new QueryCommand({
          TableName: META_SCHEDULED_CAMPAIGNS_TABLE,
          IndexName: 'userId-index',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: { ':userId': userId }
        }));
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          scheduledCampaigns: result.Items || [],
          total: result.Items?.length || 0
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /meta/ads/scheduled/{scheduledId} - Cancel scheduled
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/scheduled\/[^\/]+$/) && method === 'DELETE') {
      const scheduledId = event.pathParameters?.scheduledId;
      if (!scheduledId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'scheduledId required' })
        };
      }

      // Update status to CANCELLED instead of deleting
      await ddb.send(new UpdateCommand({
        TableName: META_SCHEDULED_CAMPAIGNS_TABLE,
        Key: { scheduledId },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'CANCELLED' }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Scheduled campaign cancelled',
          scheduledId
        })
      };
    }

    // =========================================================
    // OVERVIEW/AGGREGATE STATS - /meta/ads/{clinicId}/overview
    // =========================================================

    // ---------------------------------------------------------
    // GET /meta/ads/{clinicId}/overview - Get dashboard stats
    // ---------------------------------------------------------
    if (path.match(/\/meta\/ads\/[^\/]+\/overview/) && method === 'GET') {
      if (!clinicId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'clinicId required' })
        };
      }

      // Get campaigns count
      const campaignsResult = await ddb.send(new QueryCommand({
        TableName: META_CAMPAIGNS_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': clinicId }
      }));

      const campaigns = campaignsResult.Items || [];
      const activeCampaigns = campaigns.filter((c: any) => c.status === 'ACTIVE').length;
      const totalSpend = campaigns.reduce((sum: number, c: any) => sum + (c.metrics?.spend || 0), 0);
      
      // Get leads count
      const leadsResult = await ddb.send(new QueryCommand({
        TableName: META_LEADS_TABLE,
        IndexName: 'clinicId-index',
        KeyConditionExpression: 'clinicId = :clinicId',
        ExpressionAttributeValues: { ':clinicId': clinicId }
      }));

      const leads = leadsResult.Items || [];
      const totalLeads = leads.length;
      const newLeads = leads.filter((l: any) => l.status === 'new').length;
      const contactedLeads = leads.filter((l: any) => l.status === 'contacted').length;
      const convertedLeads = leads.filter((l: any) => l.status === 'converted').length;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          stats: {
            activeCampaigns,
            totalCampaigns: campaigns.length,
            totalSpendMTD: totalSpend,
            leadsGenerated: totalLeads,
            newLeads,
            contactedLeads,
            convertedLeads,
            costPerLead: totalLeads > 0 ? Math.round((totalSpend / totalLeads) * 100) / 100 : 0
          },
          recentCampaigns: campaigns.slice(0, 5)
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('Ads Handler Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};

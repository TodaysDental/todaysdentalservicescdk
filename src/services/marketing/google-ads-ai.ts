/**
 * Google Ads AI Suggestions Lambda
 * 
 * Provides AI-powered content generation for Google Ads using AWS Bedrock (Claude).
 * Generates headlines, descriptions, keywords, and negative keyword recommendations.
 * 
 * Endpoints:
 * - POST /google-ads/ai/headlines - Generate campaign headlines
 * - POST /google-ads/ai/descriptions - Generate ad descriptions
 * - POST /google-ads/ai/keywords - Generate keyword suggestions
 * - POST /google-ads/ai/negative-keywords - Analyze and suggest negative keywords
 * - POST /google-ads/ai/analyze-queries - Analyze search queries for optimization
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildCorsHeadersAsync } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import { getAllClinicsWithGoogleAdsStatus, ClinicGoogleAdsMapping } from '../../shared/utils/google-ads-client';

// Module permission configuration
const MODULE_NAME = 'Marketing';
const METHOD_PERMISSIONS: Record<string, PermissionType> = {
  GET: 'read',
  POST: 'write',
  PUT: 'put',
  DELETE: 'delete',
};

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
};

const bedrockClient = new BedrockRuntimeClient({ 
  region: CONFIG.AWS_REGION,
  maxAttempts: 3,
});

// ============================================
// SYSTEM PROMPTS FOR DENTAL PRACTICES
// ============================================

const SYSTEM_PROMPTS = {
  HEADLINES: `You are a Google Ads expert specializing in dental practice marketing. Your task is to generate compelling, action-oriented headlines for dental practice advertisements.

REQUIREMENTS:
- Each headline MUST be 30 characters or less (this is a Google Ads requirement)
- Generate exactly 15 unique headlines
- Headlines should highlight unique value propositions
- Include a mix of: benefits, calls-to-action, trust signals, and urgency
- Focus on common dental services: cleanings, implants, cosmetic, emergency, family
- Use power words: Free, New, Trusted, Expert, Same-Day, Affordable
- Consider local intent when location is provided

RESPOND WITH ONLY a JSON object in this exact format:
{
  "headlines": [
    { "text": "headline text here", "category": "benefit|cta|trust|urgency" }
  ]
}`,

  DESCRIPTIONS: `You are a Google Ads expert specializing in dental practice marketing. Your task is to generate compelling ad descriptions for dental practices.

REQUIREMENTS:
- Each description MUST be 90 characters or less (Google Ads requirement)
- Generate exactly 4 unique descriptions
- Include clear calls-to-action
- Highlight key benefits and differentiators
- Mention services, experience, or special offers when relevant

RESPOND WITH ONLY a JSON object in this exact format:
{
  "descriptions": [
    { "text": "description text here", "focus": "services|benefits|cta|trust" }
  ]
}`,

  KEYWORDS: `You are a dental marketing specialist and Google Ads keyword expert. Your task is to suggest high-intent keywords for a dental practice.

REQUIREMENTS:
- Generate 50 keyword suggestions
- Include a mix of match types: EXACT, PHRASE, and BROAD
- Focus on high-intent, local search keywords
- Include service-specific keywords (implants, crowns, whitening, etc.)
- Include location-based keywords when location is provided
- Consider different stages of the patient journey
- Avoid overly broad terms that waste ad spend

RESPOND WITH ONLY a JSON object in this exact format:
{
  "keywords": [
    { "text": "keyword text", "matchType": "EXACT|PHRASE|BROAD", "category": "service|location|emergency|cosmetic|general", "intent": "high|medium|low" }
  ]
}`,

  NEGATIVE_KEYWORDS: `You are a Google Ads optimization expert for dental practices. Your task is to analyze search query data and identify terms that should be added as negative keywords to prevent wasted ad spend.

ANALYZE EACH SEARCH QUERY FOR:
1. Irrelevant intent (DIY, educational, non-patient searches)
2. Competitor name searches
3. Job seeker searches (careers, jobs, salary, hiring)
4. Location mismatches
5. Low-value or unqualified traffic indicators
6. Searches for services not offered

RESPOND WITH ONLY a JSON object in this exact format:
{
  "negativeKeywords": [
    { 
      "text": "keyword to exclude", 
      "matchType": "EXACT|PHRASE|BROAD",
      "reason": "brief explanation why this should be excluded",
      "category": "irrelevant|competitor|jobs|location|low_value"
    }
  ],
  "summary": {
    "totalAnalyzed": number,
    "suggestedExclusions": number,
    "estimatedSavings": "explanation of potential savings"
  }
}`,

  ANALYZE_QUERIES: `You are a Google Ads optimization consultant for dental practices. Analyze the provided search query report and provide actionable optimization recommendations.

ANALYZE FOR:
1. High-cost, low-conversion queries to exclude
2. High-performing queries to add as exact match keywords
3. Patterns in search behavior
4. Opportunities for new ad groups or campaigns
5. Budget allocation recommendations

RESPOND WITH ONLY a JSON object in this exact format:
{
  "recommendations": [
    {
      "type": "add_keyword|add_negative|create_adgroup|adjust_bid|other",
      "priority": "high|medium|low",
      "action": "specific action to take",
      "rationale": "why this will improve performance",
      "affectedQueries": ["list of related queries"]
    }
  ],
  "insights": {
    "topPerformers": ["best performing search terms"],
    "wastedSpend": ["terms wasting money"],
    "opportunities": ["untapped opportunities"]
  },
  "summary": "Overall analysis summary in 2-3 sentences"
}`,
};

// ============================================
// TYPE DEFINITIONS
// ============================================

interface HeadlineRequest {
  clinicName: string;
  clinicCity?: string;
  clinicState?: string;
  services?: string[];
  uniqueSellingPoints?: string[];
  targetAudience?: string;
}

interface DescriptionRequest {
  clinicName: string;
  clinicCity?: string;
  services?: string[];
  specialOffers?: string[];
  yearsInBusiness?: number;
}

interface KeywordRequest {
  clinicName: string;
  clinicCity?: string;
  clinicState?: string;
  services?: string[];
  existingKeywords?: string[];
  competitors?: string[];
}

interface NegativeKeywordRequest {
  searchQueries: Array<{
    term: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions?: number;
  }>;
  clinicServices?: string[];
  clinicLocation?: string;
}

interface AnalyzeQueriesRequest {
  searchQueries: Array<{
    term: string;
    campaign: string;
    impressions: number;
    clicks: number;
    cost: number;
    conversions?: number;
  }>;
  campaignGoal?: string;
  targetCpa?: number;
}

interface HeadlineSuggestion {
  text: string;
  category: 'benefit' | 'cta' | 'trust' | 'urgency';
}

interface DescriptionSuggestion {
  text: string;
  focus: 'services' | 'benefits' | 'cta' | 'trust';
}

interface KeywordSuggestion {
  text: string;
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  category: string;
  intent: 'high' | 'medium' | 'low';
}

interface NegativeKeywordSuggestion {
  text: string;
  matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  reason: string;
  category: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = await buildCorsHeadersAsync({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[GoogleAdsAI] ${method} ${path}`);

  // Handle OPTIONS for CORS
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // Permission check
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
  }
  const requiredPermission: PermissionType = METHOD_PERMISSIONS[method] || 'read';
  if (!hasModulePermission(userPerms.clinicRoles, MODULE_NAME, requiredPermission, userPerms.isSuperAdmin, userPerms.isGlobalSuperAdmin)) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ success: false, error: `Access denied: requires ${MODULE_NAME} module access` }) };
  }

  try {
    // Route: POST /google-ads/ai/headlines
    if (method === 'POST' && path.includes('/ai/headlines')) {
      return await generateHeadlines(event, corsHeaders);
    }

    // Route: POST /google-ads/ai/descriptions
    if (method === 'POST' && path.includes('/ai/descriptions')) {
      return await generateDescriptions(event, corsHeaders);
    }

    // Route: POST /google-ads/ai/keywords
    if (method === 'POST' && path.includes('/ai/keywords')) {
      return await generateKeywords(event, corsHeaders);
    }

    // Route: POST /google-ads/ai/negative-keywords
    if (method === 'POST' && path.includes('/ai/negative-keywords')) {
      return await suggestNegativeKeywords(event, corsHeaders);
    }

    // Route: POST /google-ads/ai/analyze-queries
    if (method === 'POST' && path.includes('/ai/analyze-queries')) {
      return await analyzeSearchQueries(event, corsHeaders);
    }

    // Route: GET /google-ads/ai/clinic-context/{clinicId}
    if (method === 'GET' && path.includes('/ai/clinic-context')) {
      return await getClinicContext(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
    };
  }
}

// ============================================
// BEDROCK INVOCATION HELPER
// ============================================

async function invokeClaudeModel(systemPrompt: string, userPrompt: string): Promise<any> {
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: CONFIG.MAX_TOKENS,
    temperature: CONFIG.TEMPERATURE,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt }
    ],
  };

  console.log('[GoogleAdsAI] Invoking Bedrock model...');

  const command = new InvokeModelCommand({
    modelId: CONFIG.MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Extract the text content from Claude's response
  const textContent = responseBody.content?.find((c: any) => c.type === 'text')?.text;
  
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  // Parse JSON from the response
  try {
    // Try to extract JSON from the response (Claude sometimes wraps it in markdown)
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(textContent);
  } catch (parseError) {
    console.error('[GoogleAdsAI] Failed to parse Claude response:', textContent);
    throw new Error('Failed to parse AI response as JSON');
  }
}

// ============================================
// HEADLINE GENERATION
// ============================================

async function generateHeadlines(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: HeadlineRequest = JSON.parse(event.body || '{}');
  const { clinicName, clinicCity, clinicState, services, uniqueSellingPoints, targetAudience } = body;

  if (!clinicName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'clinicName is required' }),
    };
  }

  const userPrompt = `Generate Google Ads headlines for this dental practice:

CLINIC NAME: ${clinicName}
LOCATION: ${clinicCity ? `${clinicCity}, ${clinicState || ''}` : 'Not specified'}
SERVICES: ${services?.length ? services.join(', ') : 'General dentistry, cleanings, cosmetic, emergency'}
UNIQUE SELLING POINTS: ${uniqueSellingPoints?.length ? uniqueSellingPoints.join(', ') : 'Experienced team, modern technology, patient comfort'}
TARGET AUDIENCE: ${targetAudience || 'Local families and individuals seeking quality dental care'}

Remember: Each headline must be 30 characters or less. Generate exactly 15 headlines.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.HEADLINES, userPrompt);
    
    // Validate headline lengths
    const validatedHeadlines = (result.headlines || []).map((h: HeadlineSuggestion) => ({
      ...h,
      isValid: h.text.length <= 30,
      charCount: h.text.length,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        headlines: validatedHeadlines,
        total: validatedHeadlines.length,
        validCount: validatedHeadlines.filter((h: any) => h.isValid).length,
        context: { clinicName, clinicCity, clinicState },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error generating headlines:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// DESCRIPTION GENERATION
// ============================================

async function generateDescriptions(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: DescriptionRequest = JSON.parse(event.body || '{}');
  const { clinicName, clinicCity, services, specialOffers, yearsInBusiness } = body;

  if (!clinicName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'clinicName is required' }),
    };
  }

  const userPrompt = `Generate Google Ads descriptions for this dental practice:

CLINIC NAME: ${clinicName}
LOCATION: ${clinicCity || 'Not specified'}
SERVICES: ${services?.length ? services.join(', ') : 'General dentistry, cleanings, cosmetic, emergency'}
SPECIAL OFFERS: ${specialOffers?.length ? specialOffers.join(', ') : 'Free consultations, new patient specials'}
YEARS IN BUSINESS: ${yearsInBusiness || 'Established practice'}

Remember: Each description must be 90 characters or less. Generate exactly 4 descriptions.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.DESCRIPTIONS, userPrompt);
    
    // Validate description lengths
    const validatedDescriptions = (result.descriptions || []).map((d: DescriptionSuggestion) => ({
      ...d,
      isValid: d.text.length <= 90,
      charCount: d.text.length,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        descriptions: validatedDescriptions,
        total: validatedDescriptions.length,
        validCount: validatedDescriptions.filter((d: any) => d.isValid).length,
        context: { clinicName, clinicCity },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error generating descriptions:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// KEYWORD GENERATION
// ============================================

async function generateKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: KeywordRequest = JSON.parse(event.body || '{}');
  const { clinicName, clinicCity, clinicState, services, existingKeywords, competitors } = body;

  if (!clinicName) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'clinicName is required' }),
    };
  }

  const userPrompt = `Generate Google Ads keyword suggestions for this dental practice:

CLINIC NAME: ${clinicName}
LOCATION: ${clinicCity ? `${clinicCity}, ${clinicState || ''}` : 'Not specified'}
SERVICES OFFERED: ${services?.length ? services.join(', ') : 'General dentistry, cleanings, cosmetic, implants, emergency'}
EXISTING KEYWORDS (avoid duplicates): ${existingKeywords?.length ? existingKeywords.join(', ') : 'None provided'}
COMPETITORS TO EXCLUDE: ${competitors?.length ? competitors.join(', ') : 'None specified'}

Generate 50 high-intent keywords with appropriate match types. Focus on local search intent and patient acquisition.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.KEYWORDS, userPrompt);
    
    // Group keywords by category and match type
    const keywords = result.keywords || [];
    const byCategory: Record<string, KeywordSuggestion[]> = {};
    const byMatchType: Record<string, KeywordSuggestion[]> = {};
    const byIntent: Record<string, KeywordSuggestion[]> = {};

    keywords.forEach((kw: KeywordSuggestion) => {
      // Group by category
      if (!byCategory[kw.category]) byCategory[kw.category] = [];
      byCategory[kw.category].push(kw);
      
      // Group by match type
      if (!byMatchType[kw.matchType]) byMatchType[kw.matchType] = [];
      byMatchType[kw.matchType].push(kw);
      
      // Group by intent
      if (!byIntent[kw.intent]) byIntent[kw.intent] = [];
      byIntent[kw.intent].push(kw);
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        keywords,
        total: keywords.length,
        grouped: {
          byCategory,
          byMatchType,
          byIntent,
        },
        summary: {
          exactMatch: byMatchType['EXACT']?.length || 0,
          phraseMatch: byMatchType['PHRASE']?.length || 0,
          broadMatch: byMatchType['BROAD']?.length || 0,
          highIntent: byIntent['high']?.length || 0,
        },
        context: { clinicName, clinicCity, clinicState },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error generating keywords:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// NEGATIVE KEYWORD SUGGESTIONS
// ============================================

async function suggestNegativeKeywords(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: NegativeKeywordRequest = JSON.parse(event.body || '{}');
  const { searchQueries, clinicServices, clinicLocation } = body;

  if (!searchQueries || searchQueries.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'searchQueries array is required' }),
    };
  }

  // Format search queries for analysis
  const queriesText = searchQueries
    .map(q => `"${q.term}" - ${q.impressions} impressions, ${q.clicks} clicks, $${q.cost.toFixed(2)} cost${q.conversions !== undefined ? `, ${q.conversions} conversions` : ''}`)
    .join('\n');

  const userPrompt = `Analyze these search queries from a dental practice Google Ads account and identify terms that should be added as negative keywords:

CLINIC SERVICES: ${clinicServices?.join(', ') || 'General dentistry'}
CLINIC LOCATION: ${clinicLocation || 'Not specified'}

SEARCH QUERIES TO ANALYZE:
${queriesText}

Identify queries that are wasting ad spend and should be excluded. Focus on:
- Irrelevant searches (DIY, educational queries)
- Job seekers (careers, salary, hiring)
- Competitor searches
- Out-of-area searches (if location is specified)
- Low-value queries with high cost and no conversions`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.NEGATIVE_KEYWORDS, userPrompt);
    
    // Group negative keywords by category
    const negativeKeywords = result.negativeKeywords || [];
    const byCategory: Record<string, NegativeKeywordSuggestion[]> = {};

    negativeKeywords.forEach((nk: NegativeKeywordSuggestion) => {
      if (!byCategory[nk.category]) byCategory[nk.category] = [];
      byCategory[nk.category].push(nk);
    });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        negativeKeywords,
        total: negativeKeywords.length,
        grouped: { byCategory },
        summary: result.summary || {
          totalAnalyzed: searchQueries.length,
          suggestedExclusions: negativeKeywords.length,
        },
        queriesAnalyzed: searchQueries.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error suggesting negative keywords:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// SEARCH QUERY ANALYSIS
// ============================================

async function analyzeSearchQueries(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: AnalyzeQueriesRequest = JSON.parse(event.body || '{}');
  const { searchQueries, campaignGoal, targetCpa } = body;

  if (!searchQueries || searchQueries.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'searchQueries array is required' }),
    };
  }

  // Format search queries for analysis
  const queriesText = searchQueries
    .map(q => `"${q.term}" (${q.campaign}) - ${q.impressions} impr, ${q.clicks} clicks, $${q.cost.toFixed(2)}${q.conversions !== undefined ? `, ${q.conversions} conv` : ''}`)
    .join('\n');

  const userPrompt = `Analyze this search query report from a dental practice Google Ads account:

CAMPAIGN GOAL: ${campaignGoal || 'Maximize patient appointments'}
TARGET CPA: ${targetCpa ? `$${targetCpa}` : 'Not specified'}

SEARCH QUERIES:
${queriesText}

Provide actionable optimization recommendations including:
1. Keywords to add as exact match (high performers)
2. Keywords to add as negatives (wasted spend)
3. New ad group opportunities
4. Bid adjustment suggestions
5. Overall campaign optimization advice`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.ANALYZE_QUERIES, userPrompt);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        recommendations: result.recommendations || [],
        insights: result.insights || {},
        summary: result.summary || 'Analysis complete',
        queriesAnalyzed: searchQueries.length,
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error analyzing search queries:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// CLINIC CONTEXT HELPER
// ============================================

async function getClinicContext(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const clinicId = event.pathParameters?.clinicId || event.queryStringParameters?.clinicId;

  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'clinicId is required' }),
    };
  }

  try {
    // Get clinic info from Google Ads mapping
    const clinics = await getAllClinicsWithGoogleAdsStatus();
    const clinic = clinics.find(c => c.clinicId === clinicId);

    if (!clinic) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Clinic not found' }),
      };
    }

    // Return clinic context for AI generation
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        context: {
          clinicId: clinic.clinicId,
          clinicName: clinic.clinicName,
          clinicCity: clinic.clinicCity,
          clinicState: clinic.clinicState,
          hasGoogleAds: clinic.hasGoogleAds,
          customerId: clinic.customerId,
          // Default dental services (can be extended from clinic config)
          suggestedServices: [
            'General Dentistry',
            'Dental Cleanings',
            'Teeth Whitening',
            'Dental Implants',
            'Cosmetic Dentistry',
            'Emergency Dental Care',
            'Root Canals',
            'Crowns and Bridges',
            'Invisalign',
            'Pediatric Dentistry',
          ],
        },
      }),
    };
  } catch (error: any) {
    console.error('[GoogleAdsAI] Error getting clinic context:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

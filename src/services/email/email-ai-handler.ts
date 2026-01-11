/**
 * Email AI Handler Lambda
 * 
 * Provides AI-powered content generation for email marketing using AWS Bedrock (Claude).
 * Generates subject lines, email body content, and complete template designs.
 * 
 * Endpoints:
 * - POST /email/ai/subject-lines - Generate email subject lines
 * - POST /email/ai/body-content - Generate email body copy
 * - POST /email/ai/full-template - Generate complete template design JSON for Unlayer
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';

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
  // AWS_REGION is automatically provided by Lambda runtime
  MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
  MAX_TOKENS: 8192,
  TEMPERATURE: 0.7,
};

const bedrockClient = new BedrockRuntimeClient({ 
  // Uses AWS_REGION from Lambda environment automatically
  maxAttempts: 3,
});

// ============================================
// SYSTEM PROMPTS FOR DENTAL EMAIL MARKETING
// ============================================

const SYSTEM_PROMPTS = {
  SUBJECT_LINES: `You are a dental marketing email expert. Your task is to generate compelling, action-oriented subject lines for dental practice email campaigns.

REQUIREMENTS:
- Each subject line should be 50 characters or less for optimal mobile display
- Generate exactly 10 unique subject lines
- Include a mix of: urgency, curiosity, benefit-focused, and personalization
- Use dental-specific language appropriate for patient communication
- Consider including emojis sparingly (1-2 per subject max)
- Focus on the specific email type requested (appointment, promotion, follow-up, etc.)

RESPOND WITH ONLY a JSON object in this exact format:
{
  "subjectLines": [
    { "text": "subject line text", "style": "urgency|curiosity|benefit|personalization|seasonal", "hasEmoji": true|false }
  ]
}`,

  BODY_CONTENT: `You are a dental marketing copywriter specializing in patient communication emails. Your task is to generate professional, friendly email body content for dental practices.

REQUIREMENTS:
- Write in a warm, professional tone appropriate for healthcare
- Include clear calls-to-action
- Use short paragraphs for readability
- Include placeholders for personalization: {{first_name}}, {{clinic_name}}, {{clinic_phone}}, {{appointment_date}}, {{appointment_time}}
- Structure content with a greeting, body paragraphs, and a closing
- Keep content concise but engaging (150-300 words)

RESPOND WITH ONLY a JSON object in this exact format:
{
  "content": {
    "greeting": "opening greeting with {{first_name}}",
    "body": ["paragraph 1", "paragraph 2", "paragraph 3"],
    "callToAction": "clear call to action text",
    "closing": "professional closing",
    "signature": "clinic signature block with {{clinic_name}} and {{clinic_phone}}"
  },
  "htmlContent": "<full HTML formatted email content ready to use>",
  "plainTextContent": "plain text version of the email"
}`,

  FULL_TEMPLATE: `You are a dental email template designer. Your task is to generate a complete Unlayer email template design JSON for dental practices.

The template should be professional, mobile-responsive, and suitable for the specified email type.

TEMPLATE STRUCTURE:
- Header with clinic logo placeholder and name
- Hero section with relevant imagery
- Main content area with text and optional images
- Call-to-action button
- Footer with clinic contact info and unsubscribe link

Use merge tags: {{first_name}}, {{last_name}}, {{clinic_name}}, {{clinic_phone}}, {{clinic_address}}, {{appointment_date}}, {{appointment_time}}

RESPOND WITH ONLY a JSON object in this exact format:
{
  "design": {
    "counters": { "u_column": 1, "u_row": 1, "u_content_text": 1, "u_content_image": 1, "u_content_button": 1 },
    "body": {
      "id": "design-body",
      "rows": [
        // Unlayer row objects here
      ],
      "values": {
        "backgroundColor": "#f5f5f5",
        "width": "600px",
        "fontFamily": { "label": "Arial", "value": "arial,helvetica,sans-serif" },
        "linkStyle": { "body": true, "linkColor": "#2563eb", "linkHoverColor": "#1d4ed8", "linkUnderline": true }
      }
    }
  },
  "html": "<full rendered HTML for preview>",
  "suggestedSubject": "suggested email subject line",
  "description": "brief description of the template"
}`,
};

// ============================================
// TYPE DEFINITIONS
// ============================================

interface SubjectLinesRequest {
  emailType: 'welcome' | 'appointment_reminder' | 'appointment_confirmation' | 'recall' | 'promotion' | 'follow_up' | 'newsletter' | 'custom';
  clinicName?: string;
  promotionDetails?: string;
  customContext?: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
}

interface BodyContentRequest {
  emailType: 'welcome' | 'appointment_reminder' | 'appointment_confirmation' | 'recall' | 'promotion' | 'follow_up' | 'newsletter' | 'custom';
  clinicName?: string;
  clinicPhone?: string;
  promotionDetails?: string;
  appointmentDetails?: string;
  customContext?: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
  includeServices?: string[];
}

interface FullTemplateRequest {
  emailType: 'welcome' | 'appointment_reminder' | 'appointment_confirmation' | 'recall' | 'promotion' | 'follow_up' | 'newsletter' | 'custom';
  clinicName?: string;
  clinicPhone?: string;
  clinicAddress?: string;
  brandColor?: string;
  promotionDetails?: string;
  customContext?: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
  includeServices?: string[];
}

interface SubjectLineSuggestion {
  text: string;
  style: 'urgency' | 'curiosity' | 'benefit' | 'personalization' | 'seasonal';
  hasEmoji: boolean;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;

  console.log(`[EmailAI] ${method} ${path}`);

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
    // Route: POST /email/ai/subject-lines
    if (method === 'POST' && path.includes('/ai/subject-lines')) {
      return await generateSubjectLines(event, corsHeaders);
    }

    // Route: POST /email/ai/body-content
    if (method === 'POST' && path.includes('/ai/body-content')) {
      return await generateBodyContent(event, corsHeaders);
    }

    // Route: POST /email/ai/full-template
    if (method === 'POST' && path.includes('/ai/full-template')) {
      return await generateFullTemplate(event, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[EmailAI] Error:', error);
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

  console.log('[EmailAI] Invoking Bedrock model...');

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
    console.error('[EmailAI] Failed to parse Claude response:', textContent);
    throw new Error('Failed to parse AI response as JSON');
  }
}

// ============================================
// EMAIL TYPE DESCRIPTIONS
// ============================================

const EMAIL_TYPE_CONTEXT: Record<string, string> = {
  welcome: 'Welcome email for new patients who have just registered or scheduled their first appointment',
  appointment_reminder: 'Reminder email sent 24-48 hours before a scheduled dental appointment',
  appointment_confirmation: 'Confirmation email sent immediately after booking an appointment',
  recall: 'Recall email to re-engage patients who haven\'t visited in 6+ months for their regular checkup',
  promotion: 'Promotional email highlighting a special offer, discount, or seasonal promotion',
  follow_up: 'Follow-up email after a patient visit to check on their recovery and satisfaction',
  newsletter: 'Monthly/quarterly newsletter with dental tips, clinic updates, and health information',
  custom: 'Custom email based on specific requirements',
};

// ============================================
// SUBJECT LINE GENERATION
// ============================================

async function generateSubjectLines(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: SubjectLinesRequest = JSON.parse(event.body || '{}');
  const { emailType, clinicName, promotionDetails, customContext, tone } = body;

  if (!emailType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'emailType is required' }),
    };
  }

  const emailContext = EMAIL_TYPE_CONTEXT[emailType] || customContext || 'General dental email';

  const userPrompt = `Generate email subject lines for a dental practice:

EMAIL TYPE: ${emailType}
CONTEXT: ${emailContext}
CLINIC NAME: ${clinicName || 'Your Dental Office'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}

Generate exactly 10 compelling subject lines for this email type.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.SUBJECT_LINES, userPrompt);
    
    const subjectLines = (result.subjectLines || []).map((s: SubjectLineSuggestion, index: number) => ({
      ...s,
      id: index + 1,
      charCount: s.text.length,
      isOptimalLength: s.text.length <= 50,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        subjectLines,
        total: subjectLines.length,
        emailType,
        context: { clinicName, tone },
      }),
    };
  } catch (error: any) {
    console.error('[EmailAI] Error generating subject lines:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// BODY CONTENT GENERATION
// ============================================

async function generateBodyContent(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: BodyContentRequest = JSON.parse(event.body || '{}');
  const { emailType, clinicName, clinicPhone, promotionDetails, appointmentDetails, customContext, tone, includeServices } = body;

  if (!emailType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'emailType is required' }),
    };
  }

  const emailContext = EMAIL_TYPE_CONTEXT[emailType] || customContext || 'General dental email';

  const userPrompt = `Generate email body content for a dental practice:

EMAIL TYPE: ${emailType}
CONTEXT: ${emailContext}
CLINIC NAME: ${clinicName || 'Your Dental Office'}
CLINIC PHONE: ${clinicPhone || '(555) 123-4567'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${appointmentDetails ? `APPOINTMENT DETAILS: ${appointmentDetails}` : ''}
${includeServices?.length ? `SERVICES TO MENTION: ${includeServices.join(', ')}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}

Generate professional email body content with proper structure, HTML formatting, and merge tags.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.BODY_CONTENT, userPrompt);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        content: result.content,
        htmlContent: result.htmlContent,
        plainTextContent: result.plainTextContent,
        emailType,
        context: { clinicName, clinicPhone, tone },
      }),
    };
  } catch (error: any) {
    console.error('[EmailAI] Error generating body content:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// FULL TEMPLATE GENERATION
// ============================================

async function generateFullTemplate(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: FullTemplateRequest = JSON.parse(event.body || '{}');
  const { emailType, clinicName, clinicPhone, clinicAddress, brandColor, promotionDetails, customContext, tone, includeServices } = body;

  if (!emailType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'emailType is required' }),
    };
  }

  const emailContext = EMAIL_TYPE_CONTEXT[emailType] || customContext || 'General dental email';

  const userPrompt = `Generate a complete Unlayer email template for a dental practice:

EMAIL TYPE: ${emailType}
CONTEXT: ${emailContext}
CLINIC NAME: ${clinicName || 'Your Dental Office'}
CLINIC PHONE: ${clinicPhone || '(555) 123-4567'}
CLINIC ADDRESS: ${clinicAddress || '123 Main Street, City, ST 12345'}
BRAND COLOR: ${brandColor || '#2563eb'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${includeServices?.length ? `SERVICES TO FEATURE: ${includeServices.join(', ')}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}

Generate a complete, professional Unlayer template design JSON with:
1. A header with logo placeholder and clinic name
2. A hero section appropriate for the email type
3. Main content with the message
4. A prominent call-to-action button
5. A footer with clinic info and unsubscribe link

Make sure the design is mobile-responsive and uses the brand color.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.FULL_TEMPLATE, userPrompt);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        design: result.design,
        html: result.html,
        suggestedSubject: result.suggestedSubject,
        description: result.description,
        emailType,
        context: { clinicName, clinicPhone, clinicAddress, brandColor, tone },
      }),
    };
  } catch (error: any) {
    console.error('[EmailAI] Error generating full template:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

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

  FULL_TEMPLATE: `You are a dental email content writer. Generate the TEXT CONTENT for an email template. Do NOT generate HTML or JSON structures - just the text content.

REQUIREMENTS:
- Write professional, patient-friendly content for a dental practice
- Use merge tags: {{first_name}}, {{clinic_name}}, {{clinic_phone}}, {{clinic_address}}, {{appointment_date}}, {{appointment_time}}
- Keep paragraphs concise and scannable

RESPOND WITH ONLY a JSON object in this exact format:
{
  "headerText": "Clinic name or logo text (e.g., {{clinic_name}})",
  "preheaderText": "Preview text shown in email clients (1 sentence)",
  "headline": "Main headline for the email (compelling, action-oriented)",
  "bodyParagraphs": ["paragraph 1", "paragraph 2", "paragraph 3"],
  "ctaButtonText": "Call to action button text (e.g., Book Now, Confirm Appointment)",
  "ctaButtonUrl": "#",
  "footerText": "Footer with clinic info: {{clinic_name}} | {{clinic_address}} | {{clinic_phone}}",
  "unsubscribeText": "Unsubscribe from these emails",
  "suggestedSubject": "Suggested email subject line"
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
// UNLAYER DESIGN BUILDER
// ============================================

interface AITemplateContent {
  headerText: string;
  preheaderText: string;
  headline: string;
  bodyParagraphs: string[];
  ctaButtonText: string;
  ctaButtonUrl: string;
  footerText: string;
  unsubscribeText: string;
  suggestedSubject: string;
}

function buildUnlayerDesign(content: AITemplateContent, brandColor: string): object {
  const primaryColor = brandColor || '#2563eb';
  
  // Generate unique IDs
  let counter = 1;
  const nextId = () => `u_content_${counter++}`;
  
  const design = {
    counters: {
      u_column: 6,
      u_row: 6,
      u_content_text: 10,
      u_content_button: 2,
      u_content_divider: 2,
      u_content_image: 1,
    },
    body: {
      id: 'design-body',
      rows: [
        // Row 1: Header with clinic name
        {
          id: nextId(),
          cells: [1],
          columns: [{
            id: nextId(),
            contents: [{
              id: nextId(),
              type: 'text',
              values: {
                containerPadding: '20px 30px',
                anchor: '',
                textAlign: 'center',
                lineHeight: '140%',
                linkStyle: {
                  inherit: true,
                  linkColor: primaryColor,
                  linkHoverColor: primaryColor,
                  linkUnderline: true,
                  linkHoverUnderline: true,
                },
                text: `<p style="font-size: 24px; font-weight: bold; color: ${primaryColor};">${content.headerText}</p>`,
              },
            }],
            values: {
              backgroundColor: '#ffffff',
              padding: '0px',
              border: {},
              _meta: { htmlID: 'u_column_1', htmlClassNames: 'u_column' },
            },
          }],
          values: {
            displayCondition: null,
            columns: false,
            backgroundColor: '#ffffff',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
            padding: '0px',
            anchor: '',
            _meta: { htmlID: 'u_row_1', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
        // Row 2: Hero headline
        {
          id: nextId(),
          cells: [1],
          columns: [{
            id: nextId(),
            contents: [{
              id: nextId(),
              type: 'text',
              values: {
                containerPadding: '30px',
                anchor: '',
                textAlign: 'center',
                lineHeight: '150%',
                linkStyle: { inherit: true, linkColor: primaryColor, linkHoverColor: primaryColor, linkUnderline: true, linkHoverUnderline: true },
                text: `<h1 style="font-size: 28px; font-weight: bold; color: #1a1a1a; margin: 0;">${content.headline}</h1>
                       <p style="font-size: 14px; color: #666; margin-top: 10px;">${content.preheaderText}</p>`,
              },
            }],
            values: {
              backgroundColor: `${primaryColor}10`,
              padding: '0px',
              border: {},
              _meta: { htmlID: 'u_column_2', htmlClassNames: 'u_column' },
            },
          }],
          values: {
            displayCondition: null,
            columns: false,
            backgroundColor: '',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
            padding: '0px',
            anchor: '',
            _meta: { htmlID: 'u_row_2', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
        // Row 3: Body content paragraphs
        {
          id: nextId(),
          cells: [1],
          columns: [{
            id: nextId(),
            contents: [{
              id: nextId(),
              type: 'text',
              values: {
                containerPadding: '20px 30px',
                anchor: '',
                textAlign: 'left',
                lineHeight: '160%',
                linkStyle: { inherit: true, linkColor: primaryColor, linkHoverColor: primaryColor, linkUnderline: true, linkHoverUnderline: true },
                text: content.bodyParagraphs.map(p => `<p style="font-size: 16px; color: #333; margin-bottom: 16px;">${p}</p>`).join(''),
              },
            }],
            values: {
              backgroundColor: '#ffffff',
              padding: '0px',
              border: {},
              _meta: { htmlID: 'u_column_3', htmlClassNames: 'u_column' },
            },
          }],
          values: {
            displayCondition: null,
            columns: false,
            backgroundColor: '#ffffff',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
            padding: '0px',
            anchor: '',
            _meta: { htmlID: 'u_row_3', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
        // Row 4: CTA Button
        {
          id: nextId(),
          cells: [1],
          columns: [{
            id: nextId(),
            contents: [{
              id: nextId(),
              type: 'button',
              values: {
                containerPadding: '20px 30px 30px',
                anchor: '',
                href: {
                  name: 'web',
                  values: { href: content.ctaButtonUrl || '#', target: '_blank' },
                },
                buttonColors: {
                  color: '#ffffff',
                  backgroundColor: primaryColor,
                  hoverColor: '#ffffff',
                  hoverBackgroundColor: primaryColor,
                },
                size: { autoWidth: false, width: '100%' },
                textAlign: 'center',
                lineHeight: '120%',
                padding: '15px 30px',
                border: {},
                borderRadius: '6px',
                text: `<span style="font-size: 16px; font-weight: bold;">${content.ctaButtonText}</span>`,
              },
            }],
            values: {
              backgroundColor: '#ffffff',
              padding: '0px',
              border: {},
              _meta: { htmlID: 'u_column_4', htmlClassNames: 'u_column' },
            },
          }],
          values: {
            displayCondition: null,
            columns: false,
            backgroundColor: '#ffffff',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
            padding: '0px',
            anchor: '',
            _meta: { htmlID: 'u_row_4', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
        // Row 5: Divider
        {
          id: nextId(),
          cells: [1],
          columns: [{
            id: nextId(),
            contents: [{
              id: nextId(),
              type: 'divider',
              values: {
                containerPadding: '10px 30px',
                anchor: '',
                border: { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#e0e0e0' },
                textAlign: 'center',
                width: '100%',
              },
            }],
            values: {
              backgroundColor: '#f5f5f5',
              padding: '0px',
              border: {},
              _meta: { htmlID: 'u_column_5', htmlClassNames: 'u_column' },
            },
          }],
          values: {
            displayCondition: null,
            columns: false,
            backgroundColor: '#f5f5f5',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
            padding: '0px',
            anchor: '',
            _meta: { htmlID: 'u_row_5', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
        // Row 6: Footer
        {
          id: nextId(),
          cells: [1],
          columns: [{
            id: nextId(),
            contents: [{
              id: nextId(),
              type: 'text',
              values: {
                containerPadding: '20px 30px',
                anchor: '',
                textAlign: 'center',
                lineHeight: '150%',
                linkStyle: { inherit: true, linkColor: '#666', linkHoverColor: '#333', linkUnderline: true, linkHoverUnderline: true },
                text: `<p style="font-size: 12px; color: #666; margin: 0;">${content.footerText}</p>
                       <p style="font-size: 11px; color: #999; margin-top: 10px;"><a href="#" style="color: #999;">${content.unsubscribeText}</a></p>`,
              },
            }],
            values: {
              backgroundColor: '#f5f5f5',
              padding: '0px',
              border: {},
              _meta: { htmlID: 'u_column_6', htmlClassNames: 'u_column' },
            },
          }],
          values: {
            displayCondition: null,
            columns: false,
            backgroundColor: '#f5f5f5',
            columnsBackgroundColor: '',
            backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
            padding: '0px',
            anchor: '',
            _meta: { htmlID: 'u_row_6', htmlClassNames: 'u_row' },
            selectable: true,
            draggable: true,
            duplicatable: true,
            deletable: true,
          },
        },
      ],
      values: {
        popupPosition: 'center',
        popupWidth: '600px',
        popupHeight: 'auto',
        borderRadius: '10px',
        contentAlign: 'center',
        contentVerticalAlign: 'center',
        contentWidth: '600px',
        fontFamily: { label: 'Arial', value: 'arial,helvetica,sans-serif' },
        textColor: '#000000',
        popupBackgroundColor: '#FFFFFF',
        popupBackgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'cover', position: 'center' },
        popupOverlay_backgroundColor: 'rgba(0, 0, 0, 0.1)',
        popupCloseButton_position: 'top-right',
        popupCloseButton_backgroundColor: '#DDDDDD',
        popupCloseButton_iconColor: '#000000',
        popupCloseButton_borderRadius: '0px',
        popupCloseButton_margin: '0px',
        popupCloseButton_action: { name: 'close_popup', attrs: { onClick: "document.querySelector('.u-popup-container').style.display = 'none';" } },
        backgroundColor: '#f0f0f0',
        backgroundImage: { url: '', fullWidth: true, repeat: 'no-repeat', size: 'custom', position: 'center' },
        preheaderText: content.preheaderText,
        linkStyle: { body: true, linkColor: primaryColor, linkHoverColor: primaryColor, linkUnderline: true, linkHoverUnderline: true },
        _meta: { htmlID: 'u_body', htmlClassNames: 'u_body' },
      },
    },
    schemaVersion: 16,
  };
  
  return design;
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

  const userPrompt = `Generate email content for a dental practice:

EMAIL TYPE: ${emailType}
CONTEXT: ${emailContext}
CLINIC NAME: ${clinicName || '{{clinic_name}}'}
CLINIC PHONE: ${clinicPhone || '{{clinic_phone}}'}
CLINIC ADDRESS: ${clinicAddress || '{{clinic_address}}'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${includeServices?.length ? `SERVICES TO FEATURE: ${includeServices.join(', ')}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}

Generate the text content for this email. Use merge tags like {{first_name}}, {{clinic_name}}, {{appointment_date}} where appropriate.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.FULL_TEMPLATE, userPrompt);
    
    // Build Unlayer design from AI content
    const aiContent: AITemplateContent = {
      headerText: result.headerText || clinicName || '{{clinic_name}}',
      preheaderText: result.preheaderText || '',
      headline: result.headline || 'Welcome!',
      bodyParagraphs: result.bodyParagraphs || ['Your content here.'],
      ctaButtonText: result.ctaButtonText || 'Learn More',
      ctaButtonUrl: result.ctaButtonUrl || '#',
      footerText: result.footerText || `${clinicName || '{{clinic_name}}'} | ${clinicAddress || '{{clinic_address}}'} | ${clinicPhone || '{{clinic_phone}}'}`,
      unsubscribeText: result.unsubscribeText || 'Unsubscribe',
      suggestedSubject: result.suggestedSubject || 'Message from your dental office',
    };
    
    const design = buildUnlayerDesign(aiContent, brandColor || '#2563eb');

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        design,
        suggestedSubject: aiContent.suggestedSubject,
        aiContent, // Also return raw content for reference
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

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

  HTML_TEMPLATE: `You are a World-Class Email Marketing Architect & Designer.
Your goal is to generate a PRODUCTION-READY, FLAWLESS HTML email template that renders perfectly in all major clients (Gmail, Outlook Desktop/Mobile, Apple Mail, iOS/Android).

## INPUT CONTEXT
You will be provided with:
- **Email Type** (e.g., Appointment Confirmation, Promotion, Newsletter)
- **Clinic Context** (Name, Phone, Branding)
- **Content Requirements** (Tone, key messages, offers)

## STRICT OUTPUT RULES
1. **Return ONLY valid JSON** with this exact structure:
   {
     "subject": "compelling subject line (max 50 chars)",
     "preheader": "preview text (hidden in body but visible in client preview)",
     "html": "<!DOCTYPE html>..."
   }
2. **The html field MUST:**
   - Contain the FULL, minified HTML document including <!DOCTYPE html>.
   - Be completely self-contained (no external CSS files).
   - Use **INLINE CSS** for everything.
   - NOT use Markdown formatting (return raw string).

## DESIGN SYSTEM (FRONTEND AUTHORITATIVE)
**Brand Personality**: Clean, Modern, Premium, Healthcare-Professional.

### 1. Typography (Web-Safe)
- **Font Stack**: 'Helvetica Neue', Helvetica, Arial, sans-serif (Universal support).
- **Headings**: Color #111827 | Weight 700 | Line-Height 1.3.
  - H1: 28px (Desktop) / 24px (Mobile)
  - H2: 24px (Desktop) / 20px (Mobile)
- **Body Text**: Color #4B5563 | Weight 400 | Size 16px | Line-Height 1.6.
- **Links**: Color #2563EB (Brand Blue) | Text-Decoration none (underline on hover).

### 2. Color Palette
- **Brand Primary**: #2563EB (Solid Blue - High contrast, stable rendering).
- **Background**: #F4F4F6 (Light Gray - clean outer wrapper).
- **Content Container**: #FFFFFF (White - clear readability).
- **Success/Green**: #10B981 (Appointment Confirmed).
- **Urgent/Red**: #DC2626 (Expiring Benefits).
- **Text Dark**: #111827 | **Text Muted**: #6B7280.

### 3. Components & Spacing
- **Container**: Max-width 600px. Centered.
- **Cards**: White bg, Border 1px solid #E5E7EB, Border-Radius 12px, Padding 24px.
- **Buttons**:
  - Background: #2563EB.
  - Text: #FFFFFF (Bold 16px).
  - Radius: 8px.
  - Padding: 12px 32px.
  - **Outlook Fix**: MUST use mso-padding-alt or border-based button technique.
- **Spacing Grid**: 8px increments (8, 16, 24, 32, 40, 48).

## TECHNICAL CONSTRAINTS (CDK AUTHORITATIVE)
**Compatibility Checklist (The "Fix Everything" List):**
1. **Outlook Scaling**: Use <!--[if mso]>...<![endif]--> "Ghost Tables" for all columns.
2. **Table Resets**: border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt;.
3. **Images**: display: block; border: 0; outline: none; text-decoration: none;.
4. **Dark Mode**: Add <meta name="color-scheme" content="light only"> and CSS overrides to force Light Mode styles (consistently clean look).
5. **Fluid-Hybrid Layout**: Use max-width + width: 100% tables for responsiveness.

## EXAMPLE HTML STRUCTURE
<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->
  <style>
    /* Client-specific Resets */
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #F4F4F6; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    
    /* Button Hover */
    .btn:hover { background-color: #1D4ED8 !important; }
    
    /* Mobile Styles */
    @media screen and (max-width: 600px) {
      .mobile-padding { padding-left: 16px !important; padding-right: 16px !important; }
      .mobile-stack { display: block !important; width: 100% !important; max-width: 100% !important; padding-bottom: 20px; }
      .h1-mobile { font-size: 24px !important; line-height: 32px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F4F4F6;">
  <!-- PREHEADER TRICK -->
  <div style="display:none;font-size:1px;color:#F4F4F6;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    {{PREHEADER_TEXT}}
  </div>

  <!-- MAIN WRAPPER -->
  <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="background-color: #F4F4F6;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <!-- [if mso]>
        <table align="center" border="0" cellspacing="0" cellpadding="0" width="600">
        <tr><td align="center" valign="top" width="600">
        <![endif]-->
        
        <!-- CONTENT CONTAINER -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" role="presentation" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
          <!-- HEADER, BODY, FOOTER GO HERE -->
        </table>
        
        <!-- [if mso]>
        </td></tr></table>
        <![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>

## YOUR TASK
Generate the JSON response for the requested email type. Ensure the HTML is completely filled with the generated content, strictly following the design tokens above.
`,
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

interface HtmlTemplateRequest {
  emailType: 'welcome' | 'appointment_reminder' | 'appointment_confirmation' | 'recall' | 'promotion' | 'follow_up' | 'newsletter' | 'new_year' | 'benefits_reminder' | 'financing' | 'custom';
  clinicName?: string;
  clinicPhone?: string;
  clinicAddress?: string;
  clinicUrl?: string;
  sunbitLink?: string;
  cherryLink?: string;
  heroImageUrl?: string;
  promotionDetails?: string;
  customContext?: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual' | 'seasonal';
  includeFinancing?: boolean;
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

    // Route: POST /email/ai/html-template
    if (method === 'POST' && path.includes('/ai/html-template')) {
      return await generateHtmlTemplate(event, corsHeaders);
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
  new_year: 'New Year themed email encouraging patients to start fresh with their dental health, use their benefits, and take advantage of financing options',
  benefits_reminder: 'Reminder email about unused dental insurance benefits that may expire at year end, encouraging patients to schedule appointments',
  financing: 'Email highlighting flexible financing and payment options like Sunbit, CareCredit, and Cherry for dental treatments',
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
  const nextId = () => `u_content_${counter++} `;

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
                text: `< p style = "font-size: 24px; font-weight: bold; color: ${primaryColor};" > ${content.headerText} </p>`,
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

// ============================================
// HTML TEMPLATE GENERATION
// ============================================

async function generateHtmlTemplate(
  event: APIGatewayProxyEvent,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: HtmlTemplateRequest = JSON.parse(event.body || '{}');
  const {
    emailType,
    clinicName,
    clinicPhone,
    clinicAddress,
    clinicUrl,
    sunbitLink,
    cherryLink,
    heroImageUrl,
    promotionDetails,
    customContext,
    tone,
    includeFinancing,
    includeServices,
  } = body;

  if (!emailType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'emailType is required' }),
    };
  }

  const emailContext = EMAIL_TYPE_CONTEXT[emailType] || customContext || 'General dental email';

  // Build a detailed prompt with all the context
  const userPrompt = `Generate a complete HTML email template for a dental practice:

EMAIL TYPE: ${emailType}
CONTEXT: ${emailContext}
CLINIC NAME: ${clinicName || '{{clinic_name}}'}
CLINIC PHONE: ${clinicPhone || '{{clinic_phone}}'}
CLINIC ADDRESS: ${clinicAddress || '{{clinic_address}}'}
CLINIC URL: ${clinicUrl || '{{clinic_url}}'}
${heroImageUrl ? `HERO IMAGE URL: ${heroImageUrl}` : 'HERO IMAGE URL: https://todaysdentalpartners.com/assets/newmefamily.jpg'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${includeServices?.length ? `SERVICES TO FEATURE: ${includeServices.join(', ')}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}

FINANCING SECTION: ${includeFinancing !== false ? 'YES - Include financing options section' : 'NO'}
${sunbitLink ? `SUNBIT LINK: ${sunbitLink}` : 'SUNBIT LINK: {{sunbit_link}}'}
${cherryLink ? `CHERRY LINK: ${cherryLink}` : 'CHERRY LINK: {{cherry_link}}'}

IMPORTANT DESIGN REQUIREMENTS:
1. Use table-based layout with 650px max width
2. All styles must be INLINE (no <style> blocks)
3. Wrap all content in nested divs with style="font-family:inherit; font-size:inherit; line-height:inherit; color:inherit;"
4. Header background: #404041, rounded badge for tagline
5. Content on white background with proper padding
6. If including financing: 3-column layout with Sunbit, CareCredit, Cherry boxes with rounded borders, logos, and Apply buttons
7. Dark CTA section at bottom with prominent white button
8. Use {{patient_name}} for patient personalization in greeting

Generate a complete, production-ready HTML email that matches modern email marketing standards.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.HTML_TEMPLATE, userPrompt);

    // Validate the response has the expected structure
    if (!result.html) {
      throw new Error('AI response missing html field');
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        subject: result.subject || 'Message from your dental office',
        preheader: result.preheader || '',
        html: result.html,
        emailType,
        context: {
          clinicName,
          clinicPhone,
          clinicAddress,
          clinicUrl,
          tone,
          includeFinancing,
        },
      }),
    };
  } catch (error: any) {
    console.error('[EmailAI] Error generating HTML template:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

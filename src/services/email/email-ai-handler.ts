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

  BODY_CONTENT: `You are a warm, patient-focused dental communicator.
Your goal is to write email content that sounds like a caring human, not a marketing machine.

CRITICAL QUALITY STANDARDS:
- Reading Level: 8th–9th grade (simple, clear words).
- Tone: Warm, reassuring, professional, and calm.
- No "marketing speak" (avoid: "hurry", "act now", "unbeatable", "state-of-the-art").
- Focus on patient benefits (health, confidence, prevention), not features.

CONTENT STRUCTURE & RULES:
1. PERSONALIZED OPENING: Use {{first_name}} naturally. Warm greeting.
2. CONTEXT & VALUE: Clear reason for emailing. Why does this matter to THEM?
3. REASSURANCE: Address concerns (cost, time, comfort) gently.
4. NATURAL CTA: A helpful next step, not a demand.

FORMATTING RULES:
- MAX 3 paragraphs total.
- MAX 2-3 sentences per paragraph.
- ONE idea per paragraph.
- NO filler words.

RESPOND WITH ONLY a JSON object in this exact format:
{
  "content": {
    "greeting": "Hi {{first_name}},",
    "body": [
      "Paragraph 1: Context and value (simple, warm).",
      "Paragraph 2: Benefit and reassurance.",
      "Paragraph 3: Helpful transition to next step."
    ],
    "callToAction": "Simple, friendly button text (e.g., Book Your Visit)",
    "closing": "Warm closing,",
    "signature": "{{clinic_name}}"
  },
  "htmlContent": "<full HTML formatted email content>",
  "plainTextContent": "plain text version"
}`,

  FULL_TEMPLATE: `You are a skilled dental practice communicator.
Generate TEXT CONTENT for an email template that builds trust and reduces anxiety.

STRICT WRITING RULES:
- Grade Level: 8th–9th grade.
- Tone: Empathetic, clear, and professional.
- Avoid jargon. Use specific, simple language.
- NO sales pressure.
- MAX 3 short paragraphs.

STRUCTURE:
1. Headline: Value-focused, not "salesy".
2. Body: Personal connection -> Benefit -> Reassurance.
3. CTA: Low-pressure invitation.

RESPOND WITH ONLY a JSON object in this exact format:
{
  "headerText": "{{clinic_name}}",
  "preheaderText": "One specific, interesting sentence for the inbox preview.",
  "headline": "Warm, benefit-driven headline",
  "bodyParagraphs": ["Para 1", "Para 2", "Para 3"],
  "ctaButtonText": "Friendly action text (e.g., Schedule Now)",
  "ctaButtonUrl": "#",
  "footerText": "{{clinic_name}} | {{clinic_phone}}",
  "unsubscribeText": "Unsubscribe",
  "suggestedSubject": "Natural, lower-case style subject line"
}`,

  HTML_TEMPLATE: `You are a World-Class Email Marketing Architect.

## REFERENCE HTML TEMPLATE (VISUAL SOURCE OF TRUTH)
\`\`\`html
<meta charset="UTF-8">
<meta name="viewport" c="">
<title>New Year. New You. A Healthier Smile.</title>

<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f0f0f0">
<tbody><tr>
<td align="center" style="padding:20px;">

<!-- MAIN CONTAINER -->
<table width="650" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.15);">

<!-- HEADER -->
<tbody><tr>
<td align="center" bgcolor="#232323" style="padding:50px 40px;background:#404041;color:#ffffff;">

<span style="display:inline-block;padding:10px 20px;border-radius:30px;
             background:#555555;
             font-size:13px;font-weight:600;
             border:1px solid #777777;">
NEW YEAR • NEW YOU
</span>

<h1 style="margin:18px 0 12px;font-size:32px;font-weight:700;color:#ffffff;">
A Fresh Start for Your Smile
</h1>

<p style="margin:0;font-size:18px;color:#eeeeee;">
Make the most of your dental benefits this year
</p>

</td>
</tr>

<!-- IMAGE BELOW HEADER -->
<tr>
<td align="center" style="padding:20px 40px;background:#f9f9f9;">
<img src="https://todaysdentalpartners.com/assets/newmefamily.jpg" width="100%" alt="Healthy smile" style="max-width:570px;border-radius:12px;">
</td>
</tr>

<!-- CONTENT -->
<tr>
<td style="padding:40px 40px;">

<p style="font-size:16px;margin:0 0 16px;">
Dear {{patient_name}},
</p>

<p style="font-size:16px;margin:0 0 16px;line-height:1.6;">
A new year is the perfect time for new beginnings — especially when it comes to your smile.
</p>

<p style="font-size:16px;margin:0 0 24px;line-height:1.6;">
You currently have dental benefits available that can help you stay proactive about your oral health.
</p>

<p style="font-size:16px;margin:0 0 32px;line-height:1.6;">
Many dental insurance plans do not carry unused benefits forward.
Using them now can help prevent future issues and reduce out-of-pocket costs.
</p>

</td>
</tr>

<!-- FINANCING SECTION -->
<tr>
<td style="padding:0 40px 40px;">

<h2 style="text-align:center;font-size:26px;margin-bottom:10px;">
💰 Flexible Financing Options
</h2>

<p style="text-align:center;font-size:16px;color:#6e6e73;margin-bottom:10px;">
Don't stress — we've got you covered.
</p>

<p style="text-align:center;font-size:16px;color:#6e6e73;margin-bottom:30px;">
Pre-qualify with a soft credit check.
</p>

<table width="100%" cellpadding="0" cellspacing="0">
<tbody><tr>

<!-- SUNBIT BOX -->
<td width="33%" align="center" style="padding:10px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e7;border-radius:14px;">
<tbody><tr>
<td align="center" style="padding:25px;">
<img src="https://image2url.com/images/1764588068012-9d6eefb9-49ac-40f6-b35e-3c6315978a8d.jpg" width="90" alt="Sunbit" style="display:block;margin:0 auto 12px auto;"><br>
<strong>Sunbit</strong><br>
<span style="font-size:14px;color:#6e6e73;">
Flexible monthly payment plans
</span><br><br>
<a href="{{sunbit_link}}" style="display:inline-block;background:#232323;color:#ffffff;
          padding:8px 22px;border-radius:999px;
          font-size:13px;font-weight:600;
          text-decoration:none;">
Apply
</a>
</td>
</tr>
</tbody></table>
</td>

<!-- CARECREDIT BOX -->
<td width="33%" align="center" style="padding:10px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e7;border-radius:14px;">
<tbody><tr>
<td align="center" style="padding:25px;">
<img src="https://image2url.com/images/1764588048486-6240d5b5-1f96-4e12-a532-44fdf43081cd.jpg" width="90" alt="CareCredit" style="display:block;margin:0 auto 12px auto;"><br>
<strong>CareCredit</strong><br>
<span style="font-size:14px;color:#6e6e73;">
Trusted healthcare financing
</span><br><br>
<a href="{{clinic_url}}/book-appointment" style="display:inline-block;background:#232323;color:#ffffff;
          padding:8px 22px;border-radius:999px;
          font-size:13px;font-weight:600;
          text-decoration:none;">
Apply
</a>
</td>
</tr>
</tbody></table>
</td>

<!-- CHERRY BOX -->
<td width="33%" align="center" style="padding:10px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e7;border-radius:14px;">
<tbody><tr>
<td align="center" style="padding:25px;">
<img src="https://image2url.com/images/1764588097175-b5354e57-dd46-434f-94bc-c925ee153630.jpg" width="90" alt="Cherry" style="display:block;margin:0 auto 12px auto;"><br>
<strong>Cherry</strong><br>
<span style="font-size:14px;color:#6e6e73;">
Fast decisions &amp; easy approval
</span><br><br>
<a href="{{cherry_link}}" style="display:inline-block;background:#232323;color:#ffffff;
          padding:8px 22px;border-radius:999px;
          font-size:13px;font-weight:600;
          text-decoration:none;">
Apply
</a>
</td>
</tr>
</tbody></table>
</td>

</tr>
</tbody></table>

</td>
</tr>

<!-- CTA -->
<tr>
<td align="center" bgcolor="#232323" style="padding:45px 40px;
           background:#404041;
           color:#ffffff;">
<h2 style="font-size:26px;margin-bottom:25px;color:#ffffff;">
📅 Ready to Get Started?
</h2>
<a href="{{clinic_url}}/book-appointment" style="display:inline-block;background:#ffffff;color:#232323;
          padding:18px 50px;border-radius:35px;
          font-size:18px;font-weight:700;
          text-decoration:none;">
Book Your Appointment
</a>
</td>
</tr>

</tbody></table>
<!-- END MAIN -->

</td>
</tr>
</tbody></table>
\`\`\`

You are given a REFERENCE HTML EMAIL TEMPLATE (above) whose:
- Color palette
- Typography scale
- Visual tone
- Button styles
- Border radius
- Shadow depth
are already APPROVED and MUST be preserved.

YOUR TASK:
Generate a COMPLETE, PRODUCTION-READY HTML EMAIL TEMPLATE
that keeps the SAME VISUAL STYLING as the reference template,
while improving and standardizing:
- Content quality
- Structural consistency
- Accessibility
- Email-client safety
- Maintainability

==================================================
STYLE LOCK (NON-NEGOTIABLE)
==================================================
You MUST follow the SAME styling decisions as the reference HTML:

COLOR PALETTE (DO NOT CHANGE):
- Header & CTA background: #404041 / #232323
- Page background: #f0f0f0
- Content background: #ffffff
- Muted text: #6e6e73
- White text on dark backgrounds

TYPOGRAPHY:
- Font family: inherit (Arial / Helvetica / system-safe)
- Headline size: ~32px, font-weight: 700
- Section headings: ~26px
- Body text: ~16px, line-height: 1.6
- Small UI text: ~13–14px

VISUAL STYLE:
- Rounded corners: large (12–20px)
- Soft premium shadows (no harsh borders)
- Centered, balanced layout
- Clean healthcare look
- No gradients except subtle background tones

BUTTON STYLES (LOCKED):
- Primary CTA:
  background: #ffffff
  text color: #232323
  padding: 18px 50px
  border-radius: 35px
  font-size: 16–18px
  font-weight: 700

- Secondary / pill buttons:
  background: #232323
  text color: #ffffff
  padding: 8px 22px
  border-radius: 999px
  font-size: 13px
  font-weight: 600

DO NOT introduce new colors, button styles, or typography systems.

==================================================
TECHNICAL EMAIL REQUIREMENTS
==================================================
- TABLE-BASED layout ONLY
- INLINE STYLES ONLY
- Full HTML document structure:
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email</title>
  </head>
  <body>
- Max width: 650px, centered
- Assume Outlook 2016 as worst-case client
- No flexbox, grid, position, float, JS, SVG
- Use padding (not margin) for spacing

==================================================
CONTENT STRUCTURE (KEEP SAME FLOW)
==================================================
The overall section order MUST remain the same:

1. Header with badge + main headline
2. Hero image below header
3. Personalized greeting ({{patient_name}})
4. Benefit-focused body paragraphs
5. Financing section (Sunbit, CareCredit, Cherry)
6. Strong CTA section
7. Footer with clinic details

You MAY improve:
- Wording clarity
- Sentence flow
- Consistency
- Tone polish

You MUST NOT:
- Change the intent
- Add hype
- Remove key messages

==================================================
FINANCING SECTION (STYLE-PRESERVED)
==================================================
- 3-column layout
- Rounded bordered boxes
- Logos centered
- Short descriptions
- Pill-style “Apply” buttons

Providers & links:
- Sunbit → {{sunbit_link}}
- CareCredit → {{clinic_url}}/book-appointment
- Cherry → {{cherry_link}}

==================================================
CONTENT & TONE RULES (STRICT UPGRADE)
==================================================
- **Reading Level**: 8th–9th grade (Simple, clear English).
- **Tone**: Warm, reassuring, patient-focused. NO "marketing hype".
- **Structure**:
  1. Personalized warm opening ({{patient_name}}).
  2. Context (Why we are emailing).
  3. Value/Benefit (Health/Prevention).
  4. Reassurance (Don't worry about cost/time).
  5. Helpful CTA.
- **Length**: MAX 3 paragraphs. MAX 2-3 sentences per paragraph.
- **Forbidden**: "Hurry", "Act Now", "Best in town", "State of the art".
- **Allowed**: "Help", "Care", "Health", "Comfort", "Simple".

==================================================
ACCESSIBILITY & SAFETY
==================================================
- All images MUST include alt text
- No important text inside images
- Maintain readable contrast
- Avoid ALL CAPS except small badges
- No medical guarantees or claims

==================================================
DARK MODE & CLIENT SAFETY
==================================================
- Avoid pure black (#000000)
- Avoid pure white text on light backgrounds
- Images must remain visible in dark mode
- Do not rely on background color alone

==================================================
PERSONALIZATION TAGS (REQUIRED)
==================================================
- {{patient_name}}
- {{clinic_name}}
- {{clinic_url}}
- {{clinic_phone}}
- {{clinic_address}}

==================================================
FINAL SELF-CHECK (MANDATORY)
==================================================
Before responding, verify:
- Visual styling matches the reference HTML
- No new colors or styles were introduced
- HTML is copy-paste ready
- Works in Gmail, Outlook, Apple Mail
- Content is professional and compliant

==================================================
OUTPUT FORMAT (STRICT)
==================================================
Return ONLY valid JSON.
No explanations.
No markdown.

{
  "subject": "Email subject line",
  "preheader": "Preview text for inbox clients",
  "html": "<COMPLETE, PRODUCTION-READY HTML EMAIL>"
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

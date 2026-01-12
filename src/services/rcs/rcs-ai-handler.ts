/**
 * RCS AI Handler Lambda
 * 
 * Provides AI-powered content generation for RCS messaging using AWS Bedrock (Claude).
 * Generates rich card templates, carousel content, and plain text messages.
 * Also provides configuration status checking for RCS sender setup.
 * 
 * Endpoints:
 * - POST /rcs/{clinicId}/ai/template - Generate RCS rich card/carousel template
 * - POST /rcs/{clinicId}/ai/message-body - Generate plain text message body
 * - GET /rcs/{clinicId}/config - Check RCS sender configuration status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  PermissionType,
} from '../../shared/utils/permissions-helper';
import type { RCSRichCard, RCSCarousel, RCSButton } from './send-message';

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
  MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
  MAX_TOKENS: 4096,
  TEMPERATURE: 0.7,
};

const bedrockClient = new BedrockRuntimeClient({ 
  maxAttempts: 3,
});

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const CLINIC_SECRETS_TABLE = process.env.CLINIC_SECRETS_TABLE || 'TodaysDentalInsights-ClinicSecrets';
const CLINIC_CONFIG_TABLE = process.env.CLINIC_CONFIG_TABLE || 'TodaysDentalInsights-ClinicConfig';

// ============================================
// SYSTEM PROMPTS FOR RCS MESSAGING
// ============================================

const SYSTEM_PROMPTS = {
  RICH_CARD_TEMPLATE: `You are a dental marketing expert specializing in RCS (Rich Communication Services) messaging. Your task is to generate engaging RCS rich card templates for dental practices.

RCS RICH CARD CONSTRAINTS:
- Title: Max 200 characters, compelling and action-oriented
- Description: Max 2000 characters, concise and patient-friendly
- Buttons: Max 4 buttons per card, each label max 25 characters
- Button types: "url" (website link), "reply" (quick reply), "call" (phone call), "location" (map)

REQUIREMENTS:
- Write in a warm, professional tone appropriate for healthcare
- Include clear calls-to-action via buttons
- Use placeholders: {{first_name}}, {{clinic_name}}, {{clinic_phone}}, {{appointment_date}}, {{appointment_time}}
- Keep content concise - RCS messages should be scannable on mobile
- Focus on the specific message type requested

RESPOND WITH ONLY a JSON object in this exact format:
{
  "richCard": {
    "title": "Card title (max 200 chars)",
    "description": "Card description with {{placeholders}} (max 2000 chars)",
    "mediaHeight": "medium",
    "buttons": [
      { "type": "url|reply|call|location", "label": "Button text (max 25 chars)", "value": "URL, reply text, or phone number" }
    ]
  },
  "suggestedMediaUrl": "Suggested image URL or description of ideal image",
  "plainTextFallback": "Plain SMS fallback text for non-RCS devices"
}`,

  CAROUSEL_TEMPLATE: `You are a dental marketing expert specializing in RCS carousel messages. Your task is to generate engaging RCS carousel templates with multiple cards for dental practices.

RCS CAROUSEL CONSTRAINTS:
- 2-10 cards per carousel
- Each card: Title (max 200 chars), Description (max 2000 chars), Max 4 buttons (label max 25 chars)
- Button types: "url", "reply", "call", "location"

REQUIREMENTS:
- Create cohesive card sequences that tell a story or showcase services
- Each card should be valuable standalone but work together
- Use placeholders: {{first_name}}, {{clinic_name}}, {{clinic_phone}}
- Keep content concise for mobile viewing

RESPOND WITH ONLY a JSON object in this exact format:
{
  "carousel": {
    "cardWidth": "medium",
    "cards": [
      {
        "title": "Card 1 title",
        "description": "Card 1 description",
        "mediaHeight": "medium",
        "buttons": [
          { "type": "url|reply|call", "label": "Button text", "value": "action value" }
        ]
      }
    ]
  },
  "suggestedMediaUrls": ["Description of ideal image for each card"],
  "plainTextFallback": "Plain SMS fallback text"
}`,

  MESSAGE_BODY: `You are a dental marketing copywriter specializing in RCS/SMS patient communication. Your task is to generate professional, friendly message content for dental practices.

REQUIREMENTS:
- Keep messages under 160 characters when possible for SMS compatibility
- Write in a warm, professional tone
- Include clear calls-to-action
- Use placeholders: {{first_name}}, {{clinic_name}}, {{clinic_phone}}, {{appointment_date}}, {{appointment_time}}
- Generate 3 message variations with different styles

RESPOND WITH ONLY a JSON object in this exact format:
{
  "messages": [
    { "text": "Message text with {{placeholders}}", "style": "professional|friendly|urgent", "charCount": 0 }
  ],
  "recommended": 0
}`,
};

// ============================================
// TYPE DEFINITIONS
// ============================================

type MessageType = 'appointment_reminder' | 'appointment_confirmation' | 'recall' | 'promotion' | 'follow_up' | 'welcome' | 'birthday' | 'review_request' | 'custom';

interface TemplateRequest {
  messageType: MessageType;
  clinicName?: string;
  clinicPhone?: string;
  promotionDetails?: string;
  customContext?: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
  templateFormat?: 'richCard' | 'carousel';
  cardCount?: number; // For carousels, 2-10
}

interface MessageBodyRequest {
  messageType: MessageType;
  clinicName?: string;
  clinicPhone?: string;
  promotionDetails?: string;
  customContext?: string;
  tone?: 'professional' | 'friendly' | 'urgent' | 'casual';
}

interface RcsConfigStatus {
  clinicId: string;
  isConfigured: boolean;
  rcsSenderId?: string;
  messagingServiceSid?: string;
  clinicName?: string;
  error?: string;
}

// ============================================
// MAIN HANDLER
// ============================================

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin || event.headers?.Origin);
  const method = event.httpMethod;
  const path = event.path;
  const clinicId = event.pathParameters?.clinicId;

  console.log(`[RcsAI] ${method} ${path} clinicId=${clinicId}`);

  // Handle OPTIONS for CORS
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!clinicId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'clinicId is required' }),
    };
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
    // Route: GET /rcs/{clinicId}/config - Check RCS configuration status
    if (method === 'GET' && path.includes('/config')) {
      return await checkRcsConfig(clinicId, corsHeaders);
    }

    // Route: POST /rcs/{clinicId}/ai/template - Generate RCS template
    if (method === 'POST' && path.includes('/ai/template')) {
      return await generateTemplate(event, clinicId, corsHeaders);
    }

    // Route: POST /rcs/{clinicId}/ai/message-body - Generate message body
    if (method === 'POST' && path.includes('/ai/message-body')) {
      return await generateMessageBody(event, clinicId, corsHeaders);
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error: any) {
    console.error('[RcsAI] Error:', error);
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

  console.log('[RcsAI] Invoking Bedrock model...');

  const command = new InvokeModelCommand({
    modelId: CONFIG.MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  const textContent = responseBody.content?.find((c: any) => c.type === 'text')?.text;
  
  if (!textContent) {
    throw new Error('No text content in Claude response');
  }

  // Parse JSON from the response
  try {
    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(textContent);
  } catch (parseError) {
    console.error('[RcsAI] Failed to parse Claude response:', textContent);
    throw new Error('Failed to parse AI response as JSON');
  }
}

// ============================================
// MESSAGE TYPE DESCRIPTIONS
// ============================================

const MESSAGE_TYPE_CONTEXT: Record<MessageType, string> = {
  appointment_reminder: 'Reminder message sent 24-48 hours before a scheduled dental appointment',
  appointment_confirmation: 'Confirmation message sent immediately after booking an appointment',
  recall: 'Recall message to re-engage patients who haven\'t visited in 6+ months',
  promotion: 'Promotional message highlighting a special offer, discount, or seasonal promotion',
  follow_up: 'Follow-up message after a patient visit to check on recovery and request feedback',
  welcome: 'Welcome message for new patients who have just registered',
  birthday: 'Birthday greeting message with optional special offer',
  review_request: 'Request for patient to leave a Google or Yelp review',
  custom: 'Custom message based on specific requirements',
};

// ============================================
// CHECK RCS CONFIGURATION
// ============================================

async function checkRcsConfig(
  clinicId: string,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  try {
    // Get clinic secrets for RCS sender ID
    const secretsResult = await ddb.send(new GetCommand({
      TableName: CLINIC_SECRETS_TABLE,
      Key: { clinicId },
    }));

    // Get clinic config for clinic name
    const configResult = await ddb.send(new GetCommand({
      TableName: CLINIC_CONFIG_TABLE,
      Key: { clinicId },
    }));

    const secrets = secretsResult.Item;
    const config = configResult.Item;

    const rcsSenderId = secrets?.rcsSenderId;
    const messagingServiceSid = secrets?.messagingServiceSid;
    const clinicName = config?.clinicName || secrets?.clinicName;

    const isConfigured = !!(rcsSenderId || messagingServiceSid);

    const status: RcsConfigStatus = {
      clinicId,
      isConfigured,
      rcsSenderId: rcsSenderId || undefined,
      messagingServiceSid: messagingServiceSid || undefined,
      clinicName: clinicName || undefined,
    };

    if (!isConfigured) {
      status.error = 'No RCS sender ID or Messaging Service SID configured for this clinic';
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        config: status,
      }),
    };
  } catch (error: any) {
    console.error('[RcsAI] Error checking config:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
}

// ============================================
// GENERATE RCS TEMPLATE
// ============================================

async function generateTemplate(
  event: APIGatewayProxyEvent,
  clinicId: string,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: TemplateRequest = JSON.parse(event.body || '{}');
  const { 
    messageType, 
    clinicName, 
    clinicPhone, 
    promotionDetails, 
    customContext, 
    tone,
    templateFormat = 'richCard',
    cardCount = 3,
  } = body;

  if (!messageType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'messageType is required' }),
    };
  }

  const messageContext = MESSAGE_TYPE_CONTEXT[messageType] || customContext || 'General dental message';

  const userPrompt = `Generate an RCS ${templateFormat === 'carousel' ? 'carousel' : 'rich card'} template for a dental practice:

MESSAGE TYPE: ${messageType}
CONTEXT: ${messageContext}
CLINIC NAME: ${clinicName || '{{clinic_name}}'}
CLINIC PHONE: ${clinicPhone || '{{clinic_phone}}'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}
${templateFormat === 'carousel' ? `NUMBER OF CARDS: ${Math.min(Math.max(cardCount, 2), 10)}` : ''}

Generate a compelling ${templateFormat === 'carousel' ? 'carousel with multiple cards' : 'rich card'} for this message type.`;

  try {
    const systemPrompt = templateFormat === 'carousel' 
      ? SYSTEM_PROMPTS.CAROUSEL_TEMPLATE 
      : SYSTEM_PROMPTS.RICH_CARD_TEMPLATE;

    const result = await invokeClaudeModel(systemPrompt, userPrompt);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        templateFormat,
        messageType,
        ...(templateFormat === 'carousel' ? {
          carousel: result.carousel,
          suggestedMediaUrls: result.suggestedMediaUrls,
        } : {
          richCard: result.richCard,
          suggestedMediaUrl: result.suggestedMediaUrl,
        }),
        plainTextFallback: result.plainTextFallback,
        context: { clinicName, clinicPhone, tone },
      }),
    };
  } catch (error: any) {
    console.error('[RcsAI] Error generating template:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

// ============================================
// GENERATE MESSAGE BODY
// ============================================

async function generateMessageBody(
  event: APIGatewayProxyEvent,
  clinicId: string,
  corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
  const body: MessageBodyRequest = JSON.parse(event.body || '{}');
  const { messageType, clinicName, clinicPhone, promotionDetails, customContext, tone } = body;

  if (!messageType) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'messageType is required' }),
    };
  }

  const messageContext = MESSAGE_TYPE_CONTEXT[messageType] || customContext || 'General dental message';

  const userPrompt = `Generate RCS/SMS message variations for a dental practice:

MESSAGE TYPE: ${messageType}
CONTEXT: ${messageContext}
CLINIC NAME: ${clinicName || '{{clinic_name}}'}
CLINIC PHONE: ${clinicPhone || '{{clinic_phone}}'}
${promotionDetails ? `PROMOTION DETAILS: ${promotionDetails}` : ''}
${customContext ? `ADDITIONAL CONTEXT: ${customContext}` : ''}
TONE: ${tone || 'professional'}

Generate 3 message variations with different styles. Keep each under 160 characters when possible.`;

  try {
    const result = await invokeClaudeModel(SYSTEM_PROMPTS.MESSAGE_BODY, userPrompt);

    // Add character counts if not present
    const messages = (result.messages || []).map((msg: any, index: number) => ({
      ...msg,
      charCount: msg.text?.length || 0,
      id: index + 1,
    }));

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        messages,
        recommended: result.recommended || 0,
        messageType,
        context: { clinicName, clinicPhone, tone },
      }),
    };
  } catch (error: any) {
    console.error('[RcsAI] Error generating message body:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
}

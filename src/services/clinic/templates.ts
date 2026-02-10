import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { SYSTEM_MODULES } from '../../shared/types/user';
import {
  getUserPermissions,
  hasModulePermission,
  getAccessibleModules,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'Templates';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);

// ============================================
// RCS RICH MEDIA TYPES (matching rcs-stack types)
// ============================================

/**
 * RCS Button - supports URL links and quick replies
 * Twilio RCS supports up to 4 buttons per rich card
 */
interface RCSButton {
  type: 'url' | 'reply' | 'call' | 'location';
  label: string;              // Max 25 characters
  value: string;              // URL, reply text, phone number, or location
}

/**
 * RCS Rich Card - structured content with optional media and buttons
 */
interface RCSRichCard {
  title?: string;             // Max 200 characters
  description?: string;       // Max 2000 characters
  mediaUrl?: string;          // Image/video URL (recommended: 1440x720 for 16:9)
  mediaHeight?: 'short' | 'medium' | 'tall';  // Card media height
  buttons?: RCSButton[];      // Max 4 buttons
}

/**
 * RCS Carousel - horizontally scrolling collection of rich cards
 */
interface RCSCarousel {
  cards: RCSRichCard[];       // 2-10 cards
  cardWidth?: 'small' | 'medium';
}

// Template interface with module categorization
interface Template {
  template_id: string;
  template_name: string;
  module: string; // HR, Accounting, Operations, Finance, Marketing, Insurance, IT
  email_subject?: string;
  email_body?: string;
  text_message?: string;
  // RCS message fields
  rcs_message?: string;         // Plain text RCS message
  rcs_rich_card?: RCSRichCard;  // Single rich card template
  rcs_carousel?: RCSCarousel;   // Carousel template (2-10 cards)
  // Voice call (Chime SMA Speak / Amazon Polly)
  voice_message?: string;       // Plain text to be spoken
  voice_voiceId?: string;       // Polly VoiceId (e.g., Joanna)
  voice_engine?: 'standard' | 'neural';
  voice_languageCode?: string;  // e.g., en-US
  // AI Voice call (Connect + Bedrock)
  ai_voice_prompt?: string;     // Opening prompt for AI conversation
  modified_at: string;
  modified_by: string;
  created_at: string;
  clinic_id?: string; // Optional: clinic-specific templates
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  let path = event.path || event.resource || '';

  // Normalize path for custom domain mapping (strip leading /templates if present)
  if (path.startsWith('/templates/templates')) {
    path = path.replace('/templates/templates', '/templates');
  } else if (path.startsWith('/templates/templates/')) {
    path = path.replace('/templates/templates/', '/templates/');
  }

  // Handle OPTIONS request for CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  // Get user permissions from custom authorizer
  const userPerms = getUserPermissions(event);
  if (!userPerms) {
    return {
      statusCode: 401,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Unauthorized - Invalid token' }),
    };
  }

  try {
    if ((path === '/templates' || path.endsWith('/templates')) && httpMethod === 'GET') {
      return await listTemplates(event, userPerms);
    } else if ((path === '/templates' || path.endsWith('/templates')) && httpMethod === 'POST') {
      return await createTemplate(event, userPerms);
    } else if ((path.startsWith('/templates/') || path.includes('/templates/')) && httpMethod === 'DELETE') {
      const templateId = event.pathParameters?.templateId || path.split('/').pop() as string;
      return await deleteTemplate(event, userPerms, templateId);
    } else if ((path.startsWith('/templates/') || path.includes('/templates/')) && httpMethod === 'PUT') {
      const templateId = event.pathParameters?.templateId || path.split('/').pop() as string;
      return await updateTemplate(event, userPerms, templateId);
    } else {
      return {
        statusCode: 404,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: 'Not Found' }),
      };
    }
  } catch (error: any) {
    console.error('Templates handler error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

async function listTemplates(event: APIGatewayProxyEvent, userPerms: UserPermissions) {
  // Get all templates
  const command = new ScanCommand({
    TableName: TABLE_NAME,
  });

  const response = await docClient.send(command);
  const allTemplates = response.Items || [];

  // Get modules user has access to
  const accessibleModules = getAccessibleModules(
    userPerms.clinicRoles,
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  );

  // Filter templates to only show those in modules user can access
  const filteredTemplates = allTemplates.filter((template: any) => {
    // If no module specified, treat as accessible (legacy templates)
    if (!template.module) return true;

    // Check if user has access to this module
    return accessibleModules.includes(template.module);
  });

  // Group templates by module
  const templatesByModule: Record<string, any[]> = {};
  for (const template of filteredTemplates) {
    const module = template.module || 'Uncategorized';
    if (!templatesByModule[module]) {
      templatesByModule[module] = [];
    }
    templatesByModule[module].push(template);
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      templates: filteredTemplates,
      templatesByModule,
      accessibleModules,
      totalCount: filteredTemplates.length,
    }),
  };
}

async function createTemplate(event: APIGatewayProxyEvent, userPerms: UserPermissions) {
  const body = JSON.parse(event.body || '{}');

  // Validate required fields
  if (!body.template_name || !String(body.template_name).trim()) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Template name is required' }),
    };
  }

  // Require at least one content field (email/sms/rcs/voice)
  const hasAnyContent =
    (typeof body.email_body === 'string' && body.email_body.trim().length > 0) ||
    (typeof body.text_message === 'string' && body.text_message.trim().length > 0) ||
    (typeof body.rcs_message === 'string' && body.rcs_message.trim().length > 0) ||
    !!body.rcs_rich_card ||
    !!body.rcs_carousel ||
    (typeof body.voice_message === 'string' && body.voice_message.trim().length > 0) ||
    (typeof body.ai_voice_prompt === 'string' && body.ai_voice_prompt.trim().length > 0);

  if (!hasAnyContent) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error:
          'At least one template content field is required (email_body, text_message, rcs_message, rcs_rich_card, rcs_carousel, voice_message, ai_voice_prompt)',
      }),
    };
  }

  // Validate module is provided and is valid
  if (!body.module) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: 'Module is required',
        availableModules: Array.from(SYSTEM_MODULES),
      }),
    };
  }

  if (!SYSTEM_MODULES.includes(body.module as any)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Invalid module: ${body.module}`,
        availableModules: Array.from(SYSTEM_MODULES),
      }),
    };
  }

  // Check if user has WRITE permission for this module
  const canCreate = hasModulePermission(
    userPerms.clinicRoles,
    body.module,
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinic_id
  );

  if (!canCreate) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `You do not have permission to create templates in the ${body.module} module`,
      }),
    };
  }

  // Validate RCS rich card if provided
  if (body.rcs_rich_card) {
    const validation = validateRichCard(body.rcs_rich_card);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: validation.error }),
      };
    }
  }

  // Validate RCS carousel if provided
  if (body.rcs_carousel) {
    const validation = validateCarousel(body.rcs_carousel);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: validation.error }),
      };
    }
  }

  // Validate voice engine if provided
  if (body.voice_engine && !['standard', 'neural'].includes(body.voice_engine)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'voice_engine must be "standard" or "neural"' }),
    };
  }

  const templateId = uuidv4();
  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  const item: Template = {
    template_id: templateId,
    template_name: body.template_name,
    module: body.module,
    email_subject: body.email_subject || '',
    email_body: body.email_body || '',
    text_message: body.text_message || '',
    rcs_message: body.rcs_message || '',
    rcs_rich_card: body.rcs_rich_card,
    rcs_carousel: body.rcs_carousel,
    voice_message: body.voice_message || '',
    voice_voiceId: body.voice_voiceId || '',
    voice_engine: body.voice_engine,
    voice_languageCode: body.voice_languageCode || '',
    ai_voice_prompt: body.ai_voice_prompt || '',
    created_at: timestamp,
    modified_at: timestamp,
    modified_by: modifiedBy,
    clinic_id: body.clinic_id, // Optional: clinic-specific template
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await docClient.send(command);

  return {
    statusCode: 201,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      template_id: templateId,
      module: body.module,
      message: 'Template created successfully',
    }),
  };
}

async function updateTemplate(event: APIGatewayProxyEvent, userPerms: UserPermissions, templateId: string) {
  const body = JSON.parse(event.body || '{}');

  // Validate required fields
  if (!body.template_name || !String(body.template_name).trim()) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Template name is required' }),
    };
  }

  // Require at least one content field (email/sms/rcs/voice)
  const hasAnyContent =
    (typeof body.email_body === 'string' && body.email_body.trim().length > 0) ||
    (typeof body.text_message === 'string' && body.text_message.trim().length > 0) ||
    (typeof body.rcs_message === 'string' && body.rcs_message.trim().length > 0) ||
    !!body.rcs_rich_card ||
    !!body.rcs_carousel ||
    (typeof body.voice_message === 'string' && body.voice_message.trim().length > 0) ||
    (typeof body.ai_voice_prompt === 'string' && body.ai_voice_prompt.trim().length > 0);

  if (!hasAnyContent) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error:
          'At least one template content field is required (email_body, text_message, rcs_message, rcs_rich_card, rcs_carousel, voice_message, ai_voice_prompt)',
      }),
    };
  }

  // Validate module
  if (!body.module || !SYSTEM_MODULES.includes(body.module as any)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `Invalid module: ${body.module}`,
        availableModules: Array.from(SYSTEM_MODULES),
      }),
    };
  }

  // Check if user has PUT permission for this module
  const canUpdate = hasModulePermission(
    userPerms.clinicRoles,
    body.module,
    'put',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    body.clinic_id
  );

  if (!canUpdate) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `You do not have permission to update templates in the ${body.module} module`,
      }),
    };
  }

  // Validate RCS rich card if provided
  if (body.rcs_rich_card) {
    const validation = validateRichCard(body.rcs_rich_card);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: validation.error }),
      };
    }
  }

  // Validate RCS carousel if provided
  if (body.rcs_carousel) {
    const validation = validateCarousel(body.rcs_carousel);
    if (!validation.valid) {
      return {
        statusCode: 400,
        headers: getCorsHeaders(event),
        body: JSON.stringify({ error: validation.error }),
      };
    }
  }

  // Validate voice engine if provided
  if (body.voice_engine && !['standard', 'neural'].includes(body.voice_engine)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'voice_engine must be "standard" or "neural"' }),
    };
  }

  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  const item: any = {
    template_id: templateId,
    template_name: body.template_name,
    module: body.module,
    email_subject: body.email_subject || '',
    email_body: body.email_body || '',
    text_message: body.text_message || '',
    rcs_message: body.rcs_message || '',
    rcs_rich_card: body.rcs_rich_card,
    rcs_carousel: body.rcs_carousel,
    voice_message: body.voice_message || '',
    voice_voiceId: body.voice_voiceId || '',
    voice_engine: body.voice_engine,
    voice_languageCode: body.voice_languageCode || '',
    ai_voice_prompt: body.ai_voice_prompt || '',
    modified_at: timestamp,
    modified_by: modifiedBy,
    clinic_id: body.clinic_id,
  };

  // Preserve created_at if provided (from existing template)
  if (body.created_at) {
    item.created_at = body.created_at;
  }

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      template_id: templateId,
      module: body.module,
      message: 'Template updated successfully',
    }),
  };
}

async function deleteTemplate(event: APIGatewayProxyEvent, userPerms: UserPermissions, templateId: string) {
  // First, get the template to check its module
  const getCommand = new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'template_id = :tid',
    ExpressionAttributeValues: {
      ':tid': templateId,
    },
  });

  const getResponse = await docClient.send(getCommand);
  const template = getResponse.Items?.[0];

  if (!template) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Template not found' }),
    };
  }

  // Check if user has DELETE permission for this template's module
  const canDelete = hasModulePermission(
    userPerms.clinicRoles,
    template.module,
    'delete',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin,
    template.clinic_id
  );

  if (!canDelete) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({
        error: `You do not have permission to delete templates in the ${template.module} module`,
      }),
    };
  }

  // Delete the template
  const deleteCommand = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      template_id: templateId,
    },
  });

  await docClient.send(deleteCommand);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      message: 'Template deleted successfully',
      template_id: templateId,
      module: template.module,
    }),
  };
}

// ============================================
// RCS VALIDATION HELPERS
// ============================================

function validateRichCard(card: RCSRichCard): { valid: boolean; error?: string } {
  // Validate title length
  if (card.title && card.title.length > 200) {
    return { valid: false, error: 'Rich card title cannot exceed 200 characters' };
  }

  // Validate description length
  if (card.description && card.description.length > 2000) {
    return { valid: false, error: 'Rich card description cannot exceed 2000 characters' };
  }

  // Validate buttons
  if (card.buttons) {
    if (card.buttons.length > 4) {
      return { valid: false, error: 'Rich card cannot have more than 4 buttons' };
    }

    for (const button of card.buttons) {
      if (!button.label || button.label.length > 25) {
        return { valid: false, error: 'Button label is required and cannot exceed 25 characters' };
      }
      if (!button.type || !['url', 'reply', 'call', 'location'].includes(button.type)) {
        return { valid: false, error: 'Button type must be url, reply, call, or location' };
      }
      if (!button.value) {
        return { valid: false, error: 'Button value is required' };
      }
    }
  }

  // Validate media height
  if (card.mediaHeight && !['short', 'medium', 'tall'].includes(card.mediaHeight)) {
    return { valid: false, error: 'Media height must be short, medium, or tall' };
  }

  return { valid: true };
}

function validateCarousel(carousel: RCSCarousel): { valid: boolean; error?: string } {
  // Validate card count
  if (!carousel.cards || carousel.cards.length < 2) {
    return { valid: false, error: 'Carousel must have at least 2 cards' };
  }
  if (carousel.cards.length > 10) {
    return { valid: false, error: 'Carousel cannot have more than 10 cards' };
  }

  // Validate card width
  if (carousel.cardWidth && !['small', 'medium'].includes(carousel.cardWidth)) {
    return { valid: false, error: 'Carousel card width must be small or medium' };
  }

  // Validate each card
  for (let i = 0; i < carousel.cards.length; i++) {
    const cardValidation = validateRichCard(carousel.cards[i]);
    if (!cardValidation.valid) {
      return { valid: false, error: `Carousel card ${i + 1}: ${cardValidation.error}` };
    }
  }

  return { valid: true };
}

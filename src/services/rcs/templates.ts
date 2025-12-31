/**
 * RCS Template Management Handler
 * 
 * Handles CRUD operations for RCS rich message templates.
 * Templates can include rich cards, carousels, and buttons.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { RCSRichCard, RCSCarousel, RCSButton } from './send-message';
import { v4 as uuidv4 } from 'uuid';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const RCS_TEMPLATES_TABLE = process.env.RCS_TEMPLATES_TABLE!;

// ============================================
// TYPES
// ============================================

export interface RCSTemplate {
  templateId: string;
  clinicId: string;
  name: string;
  description?: string;
  category?: 'appointment' | 'reminder' | 'promotion' | 'follow-up' | 'general';
  
  // Message content
  body?: string;               // Plain text fallback
  richCard?: RCSRichCard;      // Rich card template
  carousel?: RCSCarousel;      // Carousel template
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  isActive: boolean;
  usageCount?: number;
}

interface CreateTemplateRequest {
  name: string;
  description?: string;
  category?: RCSTemplate['category'];
  body?: string;
  richCard?: RCSRichCard;
  carousel?: RCSCarousel;
}

interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  category?: RCSTemplate['category'];
  body?: string;
  richCard?: RCSRichCard;
  carousel?: RCSCarousel;
  isActive?: boolean;
}

// ============================================
// HANDLER
// ============================================

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({ allowMethods: ['OPTIONS', 'POST', 'GET', 'PUT', 'DELETE'] });

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const clinicId = event.pathParameters?.clinicId;
    const templateId = event.pathParameters?.templateId;

    if (!clinicId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'clinicId required' })
      };
    }

    // ---------------------------------------------------------
    // POST /rcs/{clinicId}/templates - Create a new template
    // ---------------------------------------------------------
    if (path.endsWith('/templates') && method === 'POST') {
      const body: CreateTemplateRequest = JSON.parse(event.body || '{}');

      if (!body.name) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Template name is required' })
        };
      }

      // Validate that at least one content type is provided
      if (!body.body && !body.richCard && !body.carousel) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ 
            success: false, 
            error: 'At least one content type (body, richCard, or carousel) is required' 
          })
        };
      }

      // Validate rich card constraints
      if (body.richCard) {
        const validation = validateRichCard(body.richCard);
        if (!validation.valid) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: validation.error })
          };
        }
      }

      // Validate carousel constraints
      if (body.carousel) {
        if (!body.carousel.cards || body.carousel.cards.length < 2) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ 
              success: false, 
              error: 'Carousel must have at least 2 cards' 
            })
          };
        }
        if (body.carousel.cards.length > 10) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ 
              success: false, 
              error: 'Carousel cannot have more than 10 cards' 
            })
          };
        }
        for (const card of body.carousel.cards) {
          const validation = validateRichCard(card);
          if (!validation.valid) {
            return {
              statusCode: 400,
              headers: corsHeaders,
              body: JSON.stringify({ success: false, error: `Carousel card error: ${validation.error}` })
            };
          }
        }
      }

      const now = new Date().toISOString();
      const newTemplateId = uuidv4();
      const createdBy = event.requestContext.authorizer?.email || 'system';

      const template: RCSTemplate = {
        templateId: newTemplateId,
        clinicId,
        name: body.name,
        description: body.description,
        category: body.category || 'general',
        body: body.body,
        richCard: body.richCard,
        carousel: body.carousel,
        createdAt: now,
        updatedAt: now,
        createdBy,
        isActive: true,
        usageCount: 0
      };

      await ddb.send(new PutCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Item: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${newTemplateId}`,
          ...template
        }
      }));

      return {
        statusCode: 201,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Template created successfully',
          template
        })
      };
    }

    // ---------------------------------------------------------
    // GET /rcs/{clinicId}/templates - List all templates
    // ---------------------------------------------------------
    if (path.endsWith('/templates') && method === 'GET') {
      const category = event.queryStringParameters?.category;
      const activeOnly = event.queryStringParameters?.activeOnly !== 'false';

      const result = await ddb.send(new QueryCommand({
        TableName: RCS_TEMPLATES_TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `CLINIC#${clinicId}`,
          ':sk': 'TEMPLATE#'
        }
      }));

      let templates = (result.Items || []) as RCSTemplate[];

      // Filter by active status
      if (activeOnly) {
        templates = templates.filter(t => t.isActive !== false);
      }

      // Filter by category
      if (category) {
        templates = templates.filter(t => t.category === category);
      }

      // Sort by most recently updated
      templates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          clinicId,
          templates,
          total: templates.length
        })
      };
    }

    // ---------------------------------------------------------
    // GET /rcs/{clinicId}/templates/{templateId} - Get single template
    // ---------------------------------------------------------
    if (templateId && method === 'GET') {
      const result = await ddb.send(new GetCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`
        }
      }));

      if (!result.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Template not found' })
        };
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          template: result.Item as RCSTemplate
        })
      };
    }

    // ---------------------------------------------------------
    // PUT /rcs/{clinicId}/templates/{templateId} - Update template
    // ---------------------------------------------------------
    if (templateId && method === 'PUT') {
      const body: UpdateTemplateRequest = JSON.parse(event.body || '{}');

      // Check template exists
      const existing = await ddb.send(new GetCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`
        }
      }));

      if (!existing.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Template not found' })
        };
      }

      // Validate rich card if provided
      if (body.richCard) {
        const validation = validateRichCard(body.richCard);
        if (!validation.valid) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: validation.error })
          };
        }
      }

      // Build update expression
      const updateExpressions: string[] = ['updatedAt = :updatedAt'];
      const expressionValues: Record<string, any> = {
        ':updatedAt': new Date().toISOString()
      };

      if (body.name !== undefined) {
        updateExpressions.push('#name = :name');
        expressionValues[':name'] = body.name;
      }
      if (body.description !== undefined) {
        updateExpressions.push('description = :description');
        expressionValues[':description'] = body.description;
      }
      if (body.category !== undefined) {
        updateExpressions.push('category = :category');
        expressionValues[':category'] = body.category;
      }
      if (body.body !== undefined) {
        updateExpressions.push('body = :body');
        expressionValues[':body'] = body.body;
      }
      if (body.richCard !== undefined) {
        updateExpressions.push('richCard = :richCard');
        expressionValues[':richCard'] = body.richCard;
      }
      if (body.carousel !== undefined) {
        updateExpressions.push('carousel = :carousel');
        expressionValues[':carousel'] = body.carousel;
      }
      if (body.isActive !== undefined) {
        updateExpressions.push('isActive = :isActive');
        expressionValues[':isActive'] = body.isActive;
      }

      await ddb.send(new UpdateCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionValues,
        ExpressionAttributeNames: body.name !== undefined ? { '#name': 'name' } : undefined
      }));

      // Fetch updated template
      const updated = await ddb.send(new GetCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Template updated successfully',
          template: updated.Item
        })
      };
    }

    // ---------------------------------------------------------
    // DELETE /rcs/{clinicId}/templates/{templateId} - Delete template
    // ---------------------------------------------------------
    if (templateId && method === 'DELETE') {
      // Check template exists
      const existing = await ddb.send(new GetCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`
        }
      }));

      if (!existing.Item) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ success: false, error: 'Template not found' })
        };
      }

      await ddb.send(new DeleteCommand({
        TableName: RCS_TEMPLATES_TABLE,
        Key: {
          pk: `CLINIC#${clinicId}`,
          sk: `TEMPLATE#${templateId}`
        }
      }));

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          message: 'Template deleted successfully',
          templateId
        })
      };
    }

    return {
      statusCode: 404,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Route not found' })
    };

  } catch (err: any) {
    console.error('RCS Templates Error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};

// ============================================
// VALIDATION HELPERS
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

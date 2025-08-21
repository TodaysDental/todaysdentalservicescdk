import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../utils/cors';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'Templates';

// Unified CORS
const corsHeaders = buildCorsHeaders();

const getGroupsFromClaims = (claims?: Record<string, any>): string[] => {
  if (!claims) return [];
  // Common shapes for groups claim in API Gateway
  const raw = claims['cognito:groups'] ?? claims['cognito:groups[]'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    // Could be JSON array string or comma separated
    const trimmed = raw.trim();
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.startsWith('"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {
        // fall through to comma split
      }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const isWriteAuthorized = (groups: string[]): boolean => {
  if (!groups || groups.length === 0) return false;
  // Only global super admin can write
  return groups.some((g) => g === 'GLOBAL__SUPER_ADMIN');
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  const path = event.path || event.resource || '';

  // Handle OPTIONS request for CORS preflight
  if (httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'CORS preflight response' }),
    };
  }

  const groups = getGroupsFromClaims((event.requestContext as any)?.authorizer?.claims);
  const wantsWrite = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'DELETE';
  if (wantsWrite && !isWriteAuthorized(groups)) {
    return {
      statusCode: 403,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  try {
    if ((path === '/templates' || path.endsWith('/templates')) && httpMethod === 'GET') {
      return await listTemplates();
    } else if ((path === '/templates' || path.endsWith('/templates')) && httpMethod === 'POST') {
      return await createTemplate(event);
    } else if ((path.startsWith('/templates/') || path.includes('/templates/')) && httpMethod === 'DELETE') {
      const templateId = event.pathParameters?.templateId || path.split('/').pop() as string;
      return await deleteTemplate(templateId);
    } else if ((path.startsWith('/templates/') || path.includes('/templates/')) && httpMethod === 'PUT') {
      const templateId = event.pathParameters?.templateId || path.split('/').pop() as string;
      return await updateTemplate(event, templateId);
    } else {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Not Found' }),
      };
    }
  } catch (error: any) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

async function listTemplates() {
  const command = new ScanCommand({
    TableName: TABLE_NAME,
  });

  const response = await docClient.send(command);
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      templates: response.Items || [],
    }),
  };
}

async function createTemplate(event: APIGatewayProxyEvent) {
  const body = JSON.parse(event.body || '{}');

  if (!body.template_name || !body.email_body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Template name and email body are required' }),
    };
  }

  const templateId = uuidv4();
  const timestamp = new Date().toISOString();

  const item = {
    template_id: templateId,
    template_name: body.template_name,
    email_subject: body.email_subject || '',
    email_body: body.email_body,
    text_message: body.text_message || '',
    modified_at: timestamp,
    modified_by: body.modified_by || 'system',
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await docClient.send(command);

  return {
    statusCode: 201,
    headers: corsHeaders,
    body: JSON.stringify({
      template_id: templateId,
      message: 'Template created successfully',
    }),
  };
}

async function updateTemplate(event: APIGatewayProxyEvent, templateId: string) {
  const body = JSON.parse(event.body || '{}');

  if (!body.template_name || !body.email_body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Template name and email body are required' }),
    };
  }

  const timestamp = new Date().toISOString();

  const item = {
    template_id: templateId,
    template_name: body.template_name,
    email_subject: body.email_subject || '',
    email_body: body.email_body,
    text_message: body.text_message || '',
    modified_at: timestamp,
    modified_by: body.modified_by || 'system',
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      template_id: templateId,
      message: 'Template updated successfully',
    }),
  };
}

async function deleteTemplate(templateId: string) {
  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      template_id: templateId,
    },
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ message: 'Template deleted successfully' }),
  };
}



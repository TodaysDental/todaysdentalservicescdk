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

// Template interface with module categorization
interface Template {
  template_id: string;
  template_name: string;
  module: string; // HR, Accounting, Operations, Finance, Marketing, Insurance, IT
  email_subject?: string;
  email_body: string;
  text_message?: string;
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
  if (!body.template_name || !body.email_body) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Template name and email body are required' }),
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

  const templateId = uuidv4();
  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  const item: Template = {
    template_id: templateId,
    template_name: body.template_name,
    module: body.module,
    email_subject: body.email_subject || '',
    email_body: body.email_body,
    text_message: body.text_message || '',
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
  if (!body.template_name || !body.email_body) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Template name and email body are required' }),
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

  const timestamp = new Date().toISOString();
  const modifiedBy = getUserDisplayName(userPerms);

  const item: any = {
    template_id: templateId,
    template_name: body.template_name,
    module: body.module,
    email_subject: body.email_subject || '',
    email_body: body.email_body,
    text_message: body.text_message || '',
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



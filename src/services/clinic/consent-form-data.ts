import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import {
  getUserPermissions,
  hasModulePermission,
  getUserDisplayName,
  UserPermissions,
} from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// The table name is passed from the stack's environment variables
const TABLE_NAME = process.env.TABLE_NAME || 'ConsentFormData';

// Dynamic CORS helper
const getCorsHeaders = (event: APIGatewayProxyEvent) => buildCorsHeaders({}, event.headers?.origin);


export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const httpMethod = event.httpMethod;
  let path = event.path || event.resource || '';

  // Normalize path for custom domain mapping (strip leading /consent-forms if present)
  // e.g., /consent-forms/consent-forms -> /consent-forms
  if (path.startsWith('/consent-forms/consent-forms')) {
    path = path.replace('/consent-forms/consent-forms', '/consent-forms');
  } else if (path.startsWith('/consent-forms/consent-forms/')) {
    path = path.replace('/consent-forms/consent-forms/', '/consent-forms/');
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

  const wantsWrite = httpMethod === 'POST' || httpMethod === 'PUT' || httpMethod === 'DELETE';
  if (wantsWrite && !hasModulePermission(
    userPerms.clinicRoles,
    'Operations',
    'write',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to modify consent forms in the Operations module' }),
    };
  }

  // Check read permission for GET requests
  if (httpMethod === 'GET' && !hasModulePermission(
    userPerms.clinicRoles,
    'Operations',
    'read',
    userPerms.isSuperAdmin,
    userPerms.isGlobalSuperAdmin
  )) {
    return {
      statusCode: 403,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'You do not have permission to read consent forms in the Operations module' }),
    };
  }

  try {
    // Check for ID in path parameters
    const consentFormId = event.pathParameters?.consentFormId;
    const isRootPath = (path === '/consent-forms' || path === '/consent-forms/');

    // Route to the correct function based on path and method
    if (isRootPath && httpMethod === 'GET') {
      return await listConsentForms(event, userPerms);
    }
    if (isRootPath && httpMethod === 'POST') {
      return await createConsentForm(event, userPerms);
    }
    // Routes that require an ID
    if (consentFormId) {
      if (httpMethod === 'GET') {
        return await getConsentForm(event, userPerms, consentFormId); // NEW
      }
      if (httpMethod === 'PUT') {
        return await updateConsentForm(event, userPerms, consentFormId);
      }
      if (httpMethod === 'DELETE') {
        return await deleteConsentForm(event, userPerms, consentFormId);
      }
    }
    
    // If no route matches
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Not Found' }),
    };

  } catch (error: any) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: error.message ?? 'Internal Server Error' }),
    };
  }
};

// GET /consent-forms
async function listConsentForms(event: APIGatewayProxyEvent, userPerms: UserPermissions) {
  const command = new ScanCommand({
    TableName: TABLE_NAME,
  });

  const response = await docClient.send(command);
  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      consentForms: response.Items || [],
    }),
  };
}

// GET /consent-forms/{consentFormId}
async function getConsentForm(event: APIGatewayProxyEvent, userPerms: UserPermissions, consentFormId: string) {
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: {
      consent_form_id: consentFormId,
    },
  });

  const response = await docClient.send(command);

  if (!response.Item) {
    return {
      statusCode: 404,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'Consent form not found' }),
    };
  }

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify(response.Item),
  };
}

// POST /consent-forms
async function createConsentForm(event: APIGatewayProxyEvent, userPerms: UserPermissions) {
  const body = JSON.parse(event.body || '{}');

  // Validate payload based on your example
  if (!body.templateName || !body.elements || !Array.isArray(body.elements)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'templateName and elements array are required' }),
    };
  }

  const consentFormId = uuidv4();
  const timestamp = new Date().toISOString();

  const item = {
    consent_form_id: consentFormId,
    templateName: body.templateName,
    elements: body.elements, // Store the full elements array
    modified_at: timestamp,
    modified_by: getUserDisplayName(userPerms),
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
      consent_form_id: consentFormId,
      message: 'Consent form created successfully',
    }),
  };
}

// PUT /consent-forms/{consentFormId}
async function updateConsentForm(event: APIGatewayProxyEvent, userPerms: UserPermissions, consentFormId: string) {
  const body = JSON.parse(event.body || '{}');

  // Validate payload
  if (!body.templateName || !body.elements || !Array.isArray(body.elements)) {
    return {
      statusCode: 400,
      headers: getCorsHeaders(event),
      body: JSON.stringify({ error: 'templateName and elements array are required' }),
    };
  }

  const timestamp = new Date().toISOString();

  const item = {
    consent_form_id: consentFormId, // This is the partition key
    templateName: body.templateName,
    elements: body.elements,
    modified_at: timestamp,
    modified_by: getUserDisplayName(userPerms),
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item, // PutCommand overwrites the item
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({
      consent_form_id: consentFormId,
      message: 'Consent form updated successfully',
    }),
  };
}

// DELETE /consent-forms/{consentFormId}
async function deleteConsentForm(event: APIGatewayProxyEvent, userPerms: UserPermissions, consentFormId: string) {
  const command = new DeleteCommand({
    TableName: TABLE_NAME,
    Key: {
      consent_form_id: consentFormId, // Specify the key to delete
    },
  });

  await docClient.send(command);

  return {
    statusCode: 200,
    headers: getCorsHeaders(event),
    body: JSON.stringify({ message: 'Consent form deleted successfully' }),
  };
}


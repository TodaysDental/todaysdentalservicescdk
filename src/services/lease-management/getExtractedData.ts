import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Get Extracted Data Event:', JSON.stringify(event, null, 2));

  try {
    // Check user permissions
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    const clinicId = event.headers['x-clinic-id'] || event.queryStringParameters?.clinicId;
    const documentId = event.queryStringParameters?.documentId;

    if (!clinicId) {
      return createResponse(400, { success: false, error: 'clinicId is required' });
    }

    // Check if user has Legal module read permission for this clinic
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }

    if (documentId) {
      // Get specific extracted document
      const result = await docClient.send(new GetCommand({
        TableName: LEASE_TABLE_NAME,
        Key: { PK: `CLINIC#${clinicId}`, SK: `EXTRACTED#${documentId}` }
      }));

      if (!result.Item) {
        return createResponse(404, { success: false, error: 'Extracted data not found' });
      }

      return createResponse(200, { success: true, data: result.Item });
    } else {
      // List all extracted documents for clinic
      const result = await docClient.send(new QueryCommand({
        TableName: LEASE_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `CLINIC#${clinicId}`,
          ':sk': 'EXTRACTED#'
        }
      }));

      const extractedDocs = (result.Items || []).map((item: any) => ({
        documentId: item.SK.replace('EXTRACTED#', ''),
        clinicId: item.PK.replace('CLINIC#', ''),
        leaseId: item.leaseId,
        sourceDocument: item.sourceDocument,
        extractedAt: item.extractedAt,
        leaseFields: item.leaseFields,
        confidence: item.confidence,
        keyValuePairsCount: Object.keys(item.keyValuePairs || {}).length,
        tablesCount: (item.tables || []).length
      }));

      return createResponse(200, {
        success: true,
        data: extractedDocs,
        count: extractedDocs.length
      });
    }

  } catch (error: any) {
    console.error('Error getting extracted data:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

function createResponse(statusCode: number, body: any): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-clinic-id',
    },
    body: JSON.stringify(body),
  };
}
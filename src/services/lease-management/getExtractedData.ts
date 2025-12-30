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
    const leaseId = event.queryStringParameters?.leaseId;

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

      return createResponse(200, { 
        success: true, 
        data: formatExtractedDocument(result.Item)
      });
    } else {
      // List all extracted documents for clinic (optionally filtered by leaseId)
      const result = await docClient.send(new QueryCommand({
        TableName: LEASE_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `CLINIC#${clinicId}`,
          ':sk': 'EXTRACTED#'
        }
      }));

      let extractedDocs = (result.Items || []).map(formatExtractedDocument);

      // Filter by leaseId if provided
      if (leaseId) {
        extractedDocs = extractedDocs.filter((doc: any) => doc.leaseId === leaseId);
      }

      // Sort by processedAt (newest first)
      extractedDocs.sort((a: any, b: any) => 
        new Date(b.processedAt || b.createdAt).getTime() - new Date(a.processedAt || a.createdAt).getTime()
      );

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

// Format extracted document for consistent response
function formatExtractedDocument(item: any): any {
  return {
    documentId: item.documentId || item.SK?.replace('EXTRACTED#', ''),
    clinicId: item.PK?.replace('CLINIC#', ''),
    leaseId: item.leaseId || item.source?.leaseId,
    documentType: item.documentType,
    source: {
      bucket: item.source?.bucket,
      fileKey: item.source?.key || item.source?.fileKey,
      filename: item.source?.filename,
      processedAt: item.source?.processedAt,
      textractJobId: item.source?.textractJobId
    },
    fields: item.fields || {},
    tables: item.tables || [],
    rawText: item.rawText,
    lines: item.lines || [],
    extraction: {
      totalFields: item.extraction?.totalFields || Object.keys(item.fields || {}).length,
      totalTables: item.extraction?.totalTables || (item.tables || []).length,
      totalLines: item.extraction?.totalLines || (item.lines || []).length,
      averageConfidence: item.extraction?.averageConfidence || 0
    },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    processedAt: item.source?.processedAt || item.createdAt
  };
}

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
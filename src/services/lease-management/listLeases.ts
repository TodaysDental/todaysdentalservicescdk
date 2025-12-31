import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('List Leases Event:', JSON.stringify(event, null, 2));

  try {
    // Check user permissions
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    // clinicId from header or query param
    const clinicId = event.headers['x-clinic-id'] || event.queryStringParameters?.clinicId;

    // Check if user has Legal module read permission
    const canRead = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'read',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId || undefined
    );
    if (!canRead) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }
    const status = event.queryStringParameters?.status;
    const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : 100;
    const lastKey = event.queryStringParameters?.lastEvaluatedKey;
    const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

    let result;

    if (clinicId) {
      // Query by specific clinic
      result = await docClient.send(new QueryCommand({
        TableName: LEASE_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `CLINIC#${clinicId}`, ':sk': 'LEASE#' },
        Limit: limit,
        ExclusiveStartKey: lastKey ? JSON.parse(lastKey) : undefined
      }));
    } else if (status) {
      // Query by status using GSI
      result = await docClient.send(new QueryCommand({
        TableName: LEASE_TABLE_NAME,
        IndexName: 'StatusIndex',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
        Limit: limit,
        ExclusiveStartKey: lastKey ? JSON.parse(lastKey) : undefined
      }));
    } else {
      // Scan all leases (for admin view across all clinics)
      result = await docClient.send(new ScanCommand({
        TableName: LEASE_TABLE_NAME,
        FilterExpression: 'begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':sk': 'LEASE#' },
        Limit: limit,
        ExclusiveStartKey: lastKey ? JSON.parse(lastKey) : undefined
      }));
    }

    let leases = result.Items || [];

    // Filter out deleted unless requested
    if (!includeDeleted) {
      leases = leases.filter((lease: any) => lease.status !== 'Deleted');
    }

    // Sort by creation date (newest first)
    leases.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Transform to table-friendly format
    const tableData = leases.map((lease: any) => ({
      // Keys for operations
      clinicId: lease.propertyInformation?.clinicId || lease.PK?.replace('CLINIC#', ''),
      leaseId: lease.SK?.replace('LEASE#', ''),
      
      // Table columns
      clinicName: lease.propertyInformation?.clinicName || '',
      city: lease.propertyInformation?.city || '',
      state: lease.propertyInformation?.state || '',
      landlord: lease.propertyInformation?.landlord || '',
      rent: lease.financialDetails?.currentRentInclCAM || lease.financialDetails?.baseRent || 0,
      baseRent: lease.financialDetails?.baseRent || 0,
      startDate: lease.leaseTerms?.startDate || '',
      endDate: lease.leaseTerms?.endDate || '',
      sqft: lease.leaseTerms?.sqft || 0,
      termLength: lease.leaseTerms?.termLength || '',
      status: lease.leaseTerms?.status || lease.status || '',
      
      // Additional useful fields
      address: lease.propertyInformation?.address || '',
      propertyType: lease.propertyInformation?.propertyType || '',
      leaseType: lease.leaseTerms?.leaseType || '',
      securityDeposit: lease.financialDetails?.securityDeposit || 0,
      
      // Counts for quick reference
      documentsCount: lease.documents?.length || 0,
      assetsCount: lease.assets?.length || 0,
      eventsCount: lease.events?.length || 0,
      
      // Timestamps and audit info
      createdAt: lease.createdAt,
      updatedAt: lease.updatedAt,
      createdBy: lease.createdBy || '',
      lastModifiedBy: lease.lastModifiedBy || ''
    }));

    return createResponse(200, {
      success: true,
      data: tableData,
      count: tableData.length,
      hasMore: !!result.LastEvaluatedKey,
      lastEvaluatedKey: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : null
    });

  } catch (error: any) {
    console.error('Error listing leases:', error);
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
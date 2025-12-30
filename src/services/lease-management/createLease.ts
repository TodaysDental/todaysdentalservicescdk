import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Create Lease Event:', JSON.stringify(event, null, 2));

  try {
    // Check user permissions
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    if (!event.body) {
      return createResponse(400, { success: false, error: 'Request body is required' });
    }

    const leaseInput = JSON.parse(event.body);

    // clinicId comes from header (set by frontend based on selected clinic)
    const clinicId = event.headers['x-clinic-id'] || leaseInput.propertyInformation?.clinicId;
    
    if (!clinicId) {
      return createResponse(400, { success: false, error: 'clinicId is required (via x-clinic-id header or propertyInformation.clinicId)' });
    }

    // Check if user has Legal module write permission for this clinic
    const canCreate = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canCreate) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }

    if (!leaseInput.leaseTerms?.startDate) {
      return createResponse(400, { success: false, error: 'startDate is required in leaseTerms' });
    }

    const year = new Date(leaseInput.leaseTerms.startDate).getFullYear();
    const leaseId = `${year}-${uuidv4().substring(0, 8)}`;
    const now = new Date().toISOString();

    // Get user info for audit trail
    const createdBy = userPerms.email || 'unknown';

    // Ensure clinicId is set in propertyInformation
    if (!leaseInput.propertyInformation) {
      leaseInput.propertyInformation = {};
    }
    leaseInput.propertyInformation.clinicId = clinicId;

    const leaseRecord = {
      PK: `CLINIC#${clinicId}`,
      SK: `LEASE#${leaseId}`,
      entityType: 'Lease',
      leaseId,
      clinicId,
      createdAt: now,
      updatedAt: now,
      createdBy,
      lastModifiedBy: createdBy,
      status: leaseInput.leaseTerms?.status || 'Draft',
      endDate: leaseInput.leaseTerms?.endDate,
      ...leaseInput,
      documents: (leaseInput.documents || []).map((doc: any) => ({
        documentId: doc.documentId || `DOC-${uuidv4().substring(0, 8)}`,
        uploadedAt: doc.uploadedAt || now,
        uploadedBy: createdBy,
        extractionStatus: 'pending',
        hasExtractedData: false,
        ...doc
      })),
      assets: (leaseInput.assets || []).map((asset: any) => ({
        assetId: asset.assetId || `AST-${uuidv4().substring(0, 8)}`,
        addedBy: createdBy,
        addedAt: now,
        ...asset
      })),
      events: (leaseInput.events || []).map((evt: any) => ({
        eventId: evt.eventId || `EVT-${uuidv4().substring(0, 8)}`,
        addedBy: createdBy,
        addedAt: now,
        ...evt
      })),
      hiddenCharges: leaseInput.hiddenCharges || {},
      contacts: (leaseInput.contacts || []).map((contact: any) => ({
        contactId: contact.contactId || `CON-${uuidv4().substring(0, 8)}`,
        addedBy: createdBy,
        addedAt: now,
        ...contact
      })),
      customFields: leaseInput.customFields || {},
      auditLog: [
        {
          action: 'created',
          timestamp: now,
          userId: createdBy,
          details: 'Lease record created'
        }
      ]
    };

    await docClient.send(new PutCommand({
      TableName: LEASE_TABLE_NAME,
      Item: leaseRecord,
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
    }));

    console.log('Lease created:', leaseRecord.PK, leaseRecord.SK, 'by', createdBy);

    return createResponse(201, { success: true, data: leaseRecord, message: 'Lease created successfully' });

  } catch (error: any) {
    console.error('Error creating lease:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return createResponse(409, { success: false, error: 'Lease already exists' });
    }
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
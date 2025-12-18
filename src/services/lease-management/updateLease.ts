import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Update Lease Event:', JSON.stringify(event, null, 2));

  try {
    // Check user permissions
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    const clinicId = event.pathParameters?.clinicId;
    const leaseId = event.pathParameters?.leaseId;

    if (!clinicId || !leaseId) {
      return createResponse(400, { success: false, error: 'clinicId and leaseId are required' });
    }

    // Check if user has Legal module put permission for this clinic
    const canUpdate = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'put',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canUpdate) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }

    if (!event.body) {
      return createResponse(400, { success: false, error: 'Request body is required' });
    }

    const updateInput = JSON.parse(event.body);
    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;

    // Check if lease exists
    const existing = await docClient.send(new GetCommand({ TableName: LEASE_TABLE_NAME, Key: { PK, SK } }));
    if (!existing.Item) {
      return createResponse(404, { success: false, error: 'Lease not found' });
    }

    const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const expressionAttributeValues: Record<string, any> = { ':updatedAt': new Date().toISOString() };

    // Handle top-level object fields
    const objectFields = ['propertyInformation', 'financialDetails', 'leaseTerms', 'renewalInformation', 'paymentTerms', 'clauses', 'notesAndRemarks'];
    
    objectFields.forEach(field => {
      if (updateInput[field]) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = { ...existing.Item![field], ...updateInput[field] };
      }
    });

    // Handle arrays with ID generation
    if (updateInput.documents) {
      const docs = updateInput.documents.map((doc: any) => ({
        documentId: doc.documentId || `DOC-${uuidv4().substring(0, 8)}`,
        uploadedAt: doc.uploadedAt || new Date().toISOString(),
        ...doc
      }));
      updateExpressions.push('#documents = :documents');
      expressionAttributeNames['#documents'] = 'documents';
      expressionAttributeValues[':documents'] = docs;
    }

    if (updateInput.assets) {
      const assets = updateInput.assets.map((a: any) => ({
        assetId: a.assetId || `AST-${uuidv4().substring(0, 8)}`,
        ...a
      }));
      updateExpressions.push('#assets = :assets');
      expressionAttributeNames['#assets'] = 'assets';
      expressionAttributeValues[':assets'] = assets;
    }

    if (updateInput.events) {
      const events = updateInput.events.map((e: any) => ({
        eventId: e.eventId || `EVT-${uuidv4().substring(0, 8)}`,
        ...e
      }));
      updateExpressions.push('#events = :events');
      expressionAttributeNames['#events'] = 'events';
      expressionAttributeValues[':events'] = events;
    }

    if (updateInput.hiddenCharges) {
      updateExpressions.push('#hiddenCharges = :hiddenCharges');
      expressionAttributeNames['#hiddenCharges'] = 'hiddenCharges';
      expressionAttributeValues[':hiddenCharges'] = { ...existing.Item!.hiddenCharges, ...updateInput.hiddenCharges };
    }

    // Update GSI fields
    if (updateInput.leaseTerms?.status) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = updateInput.leaseTerms.status;
    }

    if (updateInput.leaseTerms?.endDate) {
      updateExpressions.push('#endDate = :endDate');
      expressionAttributeNames['#endDate'] = 'endDate';
      expressionAttributeValues[':endDate'] = updateInput.leaseTerms.endDate;
    }

    const result = await docClient.send(new UpdateCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));

    return createResponse(200, { success: true, data: result.Attributes, message: 'Lease updated successfully' });

  } catch (error: any) {
    console.error('Error updating lease:', error);
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
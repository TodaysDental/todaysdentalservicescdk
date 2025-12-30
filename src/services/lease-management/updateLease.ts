import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEGAL_MODULE = 'Legal';

// Reserved fields that should not be directly updated
const RESERVED_FIELDS = ['PK', 'SK', 'entityType', 'createdAt', 'createdBy', 'auditLog'];

// Known object fields that should be merged (not replaced)
const MERGE_OBJECT_FIELDS = [
  'propertyInformation', 'financialDetails', 'leaseTerms', 'renewalInformation',
  'paymentTerms', 'clauses', 'notesAndRemarks', 'hiddenCharges', 'customFields'
];

// Known array fields that should be merged (not replaced)
const MERGE_ARRAY_FIELDS = ['documents', 'assets', 'events', 'contacts'];

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
    const now = new Date().toISOString();

    // Get user info for audit trail
    const modifiedBy = userPerms.email || 'unknown';

    // Check if lease exists
    const existing = await docClient.send(new GetCommand({ TableName: LEASE_TABLE_NAME, Key: { PK, SK } }));
    if (!existing.Item) {
      return createResponse(404, { success: false, error: 'Lease not found' });
    }

    const updateExpressions: string[] = ['#updatedAt = :updatedAt', '#lastModifiedBy = :lastModifiedBy'];
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
      '#lastModifiedBy': 'lastModifiedBy'
    };
    const expressionAttributeValues: Record<string, any> = {
      ':updatedAt': now,
      ':lastModifiedBy': modifiedBy
    };

    // Track changes for audit log
    const changes: string[] = [];

    // Process all fields in updateInput
    for (const [field, value] of Object.entries(updateInput)) {
      // Skip reserved fields
      if (RESERVED_FIELDS.includes(field)) {
        continue;
      }

      // Handle known object fields (merge with existing)
      if (MERGE_OBJECT_FIELDS.includes(field) && typeof value === 'object' && !Array.isArray(value)) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = { ...(existing.Item![field] || {}), ...value };
        changes.push(`Updated ${field}`);
        continue;
      }

      // Handle known array fields (merge with existing, using ID-based deduplication)
      if (MERGE_ARRAY_FIELDS.includes(field) && Array.isArray(value)) {
        const mergedArray = mergeArrayById(existing.Item![field] || [], value, field, modifiedBy, now);
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = mergedArray;
        changes.push(`Updated ${field} (${value.length} items)`);
        continue;
      }

      // Handle any other fields (custom fields, new fields, etc.)
      // This allows adding arbitrary fields during update
      updateExpressions.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = value;
      changes.push(`Set ${field}`);
    }

    // Update GSI fields if leaseTerms changed
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

    // Add audit log entry
    const existingAuditLog = existing.Item!.auditLog || [];
    const newAuditEntry = {
      action: 'updated',
      timestamp: now,
      userId: modifiedBy,
      details: changes.length > 0 ? changes.join(', ') : 'No changes detected'
    };
    updateExpressions.push('#auditLog = :auditLog');
    expressionAttributeNames['#auditLog'] = 'auditLog';
    expressionAttributeValues[':auditLog'] = [...existingAuditLog, newAuditEntry];

    const result = await docClient.send(new UpdateCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW'
    }));

    console.log('Lease updated:', PK, SK, 'by', modifiedBy, 'changes:', changes);

    return createResponse(200, { success: true, data: result.Attributes, message: 'Lease updated successfully' });

  } catch (error: any) {
    console.error('Error updating lease:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

// Merge arrays by ID, updating existing items and adding new ones
function mergeArrayById(
  existingArray: any[],
  newItems: any[],
  fieldType: string,
  modifiedBy: string,
  now: string
): any[] {
  const idField = getIdFieldForType(fieldType);
  const idPrefix = getIdPrefixForType(fieldType);

  // Create a map of existing items by ID
  const existingMap = new Map<string, any>();
  existingArray.forEach(item => {
    if (item[idField]) {
      existingMap.set(item[idField], item);
    }
  });

  // Process new items
  newItems.forEach(item => {
    const itemId = item[idField] || `${idPrefix}-${uuidv4().substring(0, 8)}`;
    
    if (existingMap.has(itemId)) {
      // Update existing item (merge)
      existingMap.set(itemId, {
        ...existingMap.get(itemId),
        ...item,
        [idField]: itemId,
        lastModifiedBy: modifiedBy,
        lastModifiedAt: now
      });
    } else {
      // Add new item
      existingMap.set(itemId, {
        ...item,
        [idField]: itemId,
        addedBy: modifiedBy,
        addedAt: now
      });
    }
  });

  return Array.from(existingMap.values());
}

function getIdFieldForType(fieldType: string): string {
  switch (fieldType) {
    case 'documents': return 'documentId';
    case 'assets': return 'assetId';
    case 'events': return 'eventId';
    case 'contacts': return 'contactId';
    default: return 'id';
  }
}

function getIdPrefixForType(fieldType: string): string {
  switch (fieldType) {
    case 'documents': return 'DOC';
    case 'assets': return 'AST';
    case 'events': return 'EVT';
    case 'contacts': return 'CON';
    default: return 'ITM';
  }
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
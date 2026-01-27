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
      // Support field deletion: if a field's value is explicitly null, remove it from the merged result
      if (MERGE_OBJECT_FIELDS.includes(field) && typeof value === 'object' && !Array.isArray(value)) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        
        // Start with existing data
        const existingData = existing.Item![field] || {};
        const mergedData = { ...existingData };
        
        // Process updates: set new values, delete nulls
        for (const [key, val] of Object.entries(value as Record<string, any>)) {
          if (val === null) {
            // Explicit null means "delete this field"
            delete mergedData[key];
          } else {
            // Set/update the field
            mergedData[key] = val;
          }
        }
        
        expressionAttributeValues[`:${field}`] = mergedData;
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
// Supports: _isNew: true (force new), _delete: true (remove item)
// With duplicate detection for items missing IDs
function mergeArrayById(
  existingArray: any[],
  newItems: any[],
  fieldType: string,
  modifiedBy: string,
  now: string
): any[] {
  const idField = getIdFieldForType(fieldType);
  const idPrefix = getIdPrefixForType(fieldType);

  // Create a map of existing items by ID - this is our base (all existing items are preserved)
  const resultMap = new Map<string, any>();
  existingArray.forEach(item => {
    if (item[idField]) {
      resultMap.set(item[idField], item);
    }
  });

  // Process incoming items
  newItems.forEach(item => {
    const existingId = item[idField];
    
    // Handle DELETE: If item has _delete: true flag, remove it from the result
    if (item._delete === true && existingId && resultMap.has(existingId)) {
      resultMap.delete(existingId);
      return; // Skip further processing for this item
    }
    
    if (existingId && resultMap.has(existingId)) {
      // Item has ID and exists - UPDATE/MERGE it
      // Remove control flags before storing
      const { _isNew, _delete, ...cleanItem } = item;
      resultMap.set(existingId, {
        ...resultMap.get(existingId),
        ...cleanItem,
        [idField]: existingId,
        lastModifiedBy: modifiedBy,
        lastModifiedAt: now
      });
    } else if (existingId && !resultMap.has(existingId)) {
      // Item has ID but doesn't exist in our records - ADD it (unless it's a delete request)
      if (item._delete === true) return; // Can't delete what doesn't exist
      
      const { _isNew, _delete, ...cleanItem } = item;
      resultMap.set(existingId, {
        ...cleanItem,
        [idField]: existingId,
        addedBy: item.addedBy || modifiedBy,
        addedAt: item.addedAt || now
      });
    } else if (!existingId) {
      // Item has NO ID - check for duplicates before adding
      // UNLESS the item has _isNew: true flag, which forces new item creation
      const forceNew = item._isNew === true;
      const duplicateId = forceNew ? null : findDuplicateItem(item, existingArray, fieldType, idField);
      
      // Remove control flags from the item before storing
      const { _isNew, _delete, ...cleanItem } = item;
      
      // If trying to delete by content match
      if (item._delete === true && duplicateId) {
        resultMap.delete(duplicateId);
        return;
      }
      
      if (duplicateId) {
        // Found a matching existing item - UPDATE it instead of creating duplicate
        resultMap.set(duplicateId, {
          ...resultMap.get(duplicateId),
          ...cleanItem,
          [idField]: duplicateId,
          lastModifiedBy: modifiedBy,
          lastModifiedAt: now
        });
      } else if (!item._delete) {
        // Genuinely new item - generate ID and add (skip if it was a delete attempt)
        const newId = `${idPrefix}-${uuidv4().substring(0, 8)}`;
        resultMap.set(newId, {
          ...cleanItem,
          [idField]: newId,
          addedBy: modifiedBy,
          addedAt: now
        });
      }
    }
  });

  return Array.from(resultMap.values());
}

// Find if an item without ID matches an existing item by content
function findDuplicateItem(
  newItem: any, 
  existingArray: any[], 
  fieldType: string, 
  idField: string
): string | null {
  for (const existing of existingArray) {
    if (!existing[idField]) continue;
    
    if (isContentMatch(newItem, existing, fieldType)) {
      return existing[idField];
    }
  }
  return null;
}

// Check if two items match based on content (field-type specific matching)
function isContentMatch(newItem: any, existing: any, fieldType: string): boolean {
  switch (fieldType) {
    case 'documents':
      // Match by fileKey (most reliable) or fileName
      if (newItem.fileKey && existing.fileKey) {
        return newItem.fileKey === existing.fileKey;
      }
      if (newItem.fileName && existing.fileName) {
        return newItem.fileName === existing.fileName;
      }
      if (newItem.originalFileName && existing.originalFileName) {
        return newItem.originalFileName === existing.originalFileName;
      }
      return false;
      
    case 'assets':
      // Match by name + type (or just name if type is missing)
      if (newItem.name && existing.name) {
        const nameMatch = newItem.name.toLowerCase().trim() === existing.name.toLowerCase().trim();
        if (newItem.type && existing.type) {
          return nameMatch && newItem.type === existing.type;
        }
        return nameMatch;
      }
      return false;
      
    case 'events':
      // Match by title + eventDate (or title + date)
      if (newItem.title && existing.title) {
        const titleMatch = newItem.title.toLowerCase().trim() === existing.title.toLowerCase().trim();
        const newDate = newItem.eventDate || newItem.date;
        const existDate = existing.eventDate || existing.date;
        if (newDate && existDate) {
          return titleMatch && newDate === existDate;
        }
        return titleMatch;
      }
      return false;
      
    case 'contacts':
      // Match by email OR phone OR name
      if (newItem.email && existing.email) {
        return newItem.email.toLowerCase().trim() === existing.email.toLowerCase().trim();
      }
      if (newItem.phone && existing.phone) {
        // Normalize phone numbers (remove non-digits)
        const newPhone = newItem.phone.replace(/\D/g, '');
        const existPhone = existing.phone.replace(/\D/g, '');
        return newPhone === existPhone;
      }
      if (newItem.name && existing.name) {
        return newItem.name.toLowerCase().trim() === existing.name.toLowerCase().trim();
      }
      return false;
      
    default:
      return false;
  }
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
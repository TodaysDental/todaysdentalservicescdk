import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});

const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Delete Lease Event:', JSON.stringify(event, null, 2));

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

    // Check if user has Legal module delete permission for this clinic
    const canDelete = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'delete',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinicId
    );
    if (!canDelete) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }

    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;
    const now = new Date().toISOString();
    const deletedBy = userPerms.email || 'unknown';

    // Check if lease exists
    const existing = await docClient.send(new GetCommand({ TableName: LEASE_TABLE_NAME, Key: { PK, SK } }));
    if (!existing.Item) {
      return createResponse(404, { success: false, error: 'Lease not found' });
    }

    const softDelete = event.queryStringParameters?.soft === 'true';

    if (softDelete) {
      // Soft delete: Update status and add audit log entry
      const existingAuditLog = existing.Item.auditLog || [];
      const newAuditEntry = {
        action: 'deleted',
        timestamp: now,
        userId: deletedBy,
        details: 'Lease soft deleted'
      };

      await docClient.send(new UpdateCommand({
        TableName: LEASE_TABLE_NAME,
        Key: { PK, SK },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt, #deletedAt = :deletedAt, #deletedBy = :deletedBy, #auditLog = :auditLog',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
          '#deletedAt': 'deletedAt',
          '#deletedBy': 'deletedBy',
          '#auditLog': 'auditLog'
        },
        ExpressionAttributeValues: {
          ':status': 'Deleted',
          ':updatedAt': now,
          ':deletedAt': now,
          ':deletedBy': deletedBy,
          ':auditLog': [...existingAuditLog, newAuditEntry]
        }
      }));
      return createResponse(200, { success: true, message: 'Lease soft deleted successfully' });
    } else {
      // Hard delete: Clean up S3 documents and EXTRACTED# records first
      const cleanupResults = await cleanupLeaseData(clinicId, leaseId, existing.Item.documents || []);
      
      // Delete the lease record
      await docClient.send(new DeleteCommand({
        TableName: LEASE_TABLE_NAME,
        Key: { PK, SK }
      }));

      console.log(`Lease ${leaseId} hard deleted by ${deletedBy}. Cleanup:`, cleanupResults);
      
      return createResponse(200, { 
        success: true, 
        message: 'Lease deleted successfully',
        cleanup: cleanupResults
      });
    }

  } catch (error: any) {
    console.error('Error deleting lease:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

// Clean up S3 documents and EXTRACTED# DynamoDB records
async function cleanupLeaseData(
  clinicId: string, 
  leaseId: string, 
  documents: any[]
): Promise<{ s3Deleted: number; extractedDeleted: number }> {
  let s3Deleted = 0;
  let extractedDeleted = 0;

  try {
    // 1. Delete S3 documents for this lease (folder: clinicId/leaseId/*)
    if (LEASE_DOCUMENTS_BUCKET) {
      const s3Prefix = `${clinicId}/${leaseId}/`;
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: LEASE_DOCUMENTS_BUCKET,
        Prefix: s3Prefix
      }));

      if (listResult.Contents && listResult.Contents.length > 0) {
        const objectsToDelete = listResult.Contents.map(obj => ({ Key: obj.Key! }));
        
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: LEASE_DOCUMENTS_BUCKET,
          Delete: { Objects: objectsToDelete }
        }));
        
        s3Deleted = objectsToDelete.length;
        console.log(`Deleted ${s3Deleted} S3 objects from ${s3Prefix}`);
      }
    }

    // 2. Delete EXTRACTED# records for each document
    for (const doc of documents) {
      if (doc.documentId) {
        try {
          await docClient.send(new DeleteCommand({
            TableName: LEASE_TABLE_NAME,
            Key: { 
              PK: `CLINIC#${clinicId}`, 
              SK: `EXTRACTED#${doc.documentId}` 
            }
          }));
          extractedDeleted++;
        } catch (err) {
          // Ignore if extracted record doesn't exist
          console.log(`No extracted data found for ${doc.documentId}`);
        }
      }
    }

    console.log(`Cleanup complete: ${s3Deleted} S3 files, ${extractedDeleted} extracted records`);
  } catch (error) {
    console.error('Error during cleanup (non-fatal):', error);
    // Don't throw - cleanup is best-effort, main delete already succeeded
  }

  return { s3Deleted, extractedDeleted };
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
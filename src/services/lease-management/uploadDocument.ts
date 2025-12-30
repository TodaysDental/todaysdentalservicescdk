import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { getUserPermissions, hasModulePermission } from '../../shared/utils/permissions-helper';

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const LEASE_DOCUMENTS_BUCKET = process.env.LEASE_DOCUMENTS_BUCKET!;
const LEASE_TABLE_NAME = process.env.LEASE_TABLE_NAME!;
const LEGAL_MODULE = 'Legal';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Upload Document Event:', JSON.stringify(event, null, 2));

  try {
    // Check user permissions
    const userPerms = getUserPermissions(event);
    if (!userPerms) {
      return createResponse(401, { success: false, error: 'Unauthorized' });
    }

    if (!event.body) {
      return createResponse(400, { success: false, error: 'Request body is required' });
    }

    const { clinicId, leaseId, fileName, contentType, documentType, description } = JSON.parse(event.body);

    // clinicId from header or body
    const clinic = event.headers['x-clinic-id'] || clinicId;

    if (!clinic) {
      return createResponse(400, { success: false, error: 'clinicId is required' });
    }

    // Check if user has Legal module write permission for this clinic
    const canUpload = hasModulePermission(
      userPerms.clinicRoles,
      LEGAL_MODULE,
      'write',
      userPerms.isSuperAdmin,
      userPerms.isGlobalSuperAdmin,
      clinic
    );
    if (!canUpload) {
      return createResponse(403, { success: false, error: 'Permission denied. Legal module access required.' });
    }

    if (!fileName || !contentType) {
      return createResponse(400, { success: false, error: 'fileName and contentType are required' });
    }

    // Get user info for audit trail
    const uploadedBy = userPerms.email || 'unknown';
    const now = new Date().toISOString();

    // Generate unique file key: clinicId/leaseId/documentId-filename
    const documentId = `DOC-${uuidv4().substring(0, 8)}`;
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileKey = leaseId 
      ? `${clinic}/${leaseId}/${documentId}-${sanitizedFileName}`
      : `${clinic}/temp/${documentId}-${sanitizedFileName}`;

    // Generate presigned URL for upload (valid for 15 minutes)
    const command = new PutObjectCommand({
      Bucket: LEASE_DOCUMENTS_BUCKET,
      Key: fileKey,
      ContentType: contentType,
      Metadata: {
        'clinic-id': clinic,
        'lease-id': leaseId || 'pending',
        'document-type': documentType || 'Other',
        'description': description || '',
        'original-filename': fileName,
        'uploaded-by': uploadedBy,
        'document-id': documentId
      }
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    // If leaseId provided, add document reference to lease record immediately
    if (leaseId) {
      await addDocumentToLease(clinic, leaseId, {
        documentId,
        fileKey,
        fileName: sanitizedFileName,
        originalFileName: fileName,
        contentType,
        type: documentType || 'Other',
        description: description || '',
        uploadedBy,
        uploadedAt: now,
        extractionStatus: 'pending',
        hasExtractedData: false
      });
    }

    return createResponse(200, {
      success: true,
      data: {
        uploadUrl,
        fileKey,
        documentId,
        bucket: LEASE_DOCUMENTS_BUCKET,
        expiresIn: 900,
        leaseId: leaseId || null
      },
      message: 'Upload URL generated successfully'
    });

  } catch (error: any) {
    console.error('Error generating upload URL:', error);
    return createResponse(500, { success: false, error: 'Internal server error', message: error.message });
  }
};

// Add document reference to lease record
async function addDocumentToLease(clinicId: string, leaseId: string, documentInfo: any): Promise<void> {
  try {
    const PK = `CLINIC#${clinicId}`;
    const SK = `LEASE#${leaseId}`;

    // Get existing lease
    const existing = await docClient.send(new GetCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK }
    }));

    if (!existing.Item) {
      console.log(`Lease not found for ${clinicId}/${leaseId}, document will be linked after Textract processing`);
      return;
    }

    // Add to existing documents array (don't replace)
    const documents = existing.Item.documents || [];
    
    // Check if document already exists (by documentId)
    const existingIndex = documents.findIndex((doc: any) => doc.documentId === documentInfo.documentId);
    if (existingIndex >= 0) {
      documents[existingIndex] = { ...documents[existingIndex], ...documentInfo };
    } else {
      documents.push(documentInfo);
    }

    // Update lease with new document
    await docClient.send(new UpdateCommand({
      TableName: LEASE_TABLE_NAME,
      Key: { PK, SK },
      UpdateExpression: 'SET #documents = :documents, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#documents': 'documents',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':documents': documents,
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log(`Added document ${documentInfo.documentId} to lease ${leaseId}`);
  } catch (error) {
    console.error('Error adding document to lease:', error);
    // Don't throw - upload URL generation succeeded
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
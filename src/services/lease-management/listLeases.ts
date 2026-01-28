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
    // No pagination - fetch ALL leases
    const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';

    let allLeases: any[] = [];
    let lastEvaluatedKey: any = undefined;

    // Keep scanning until we get all items (handle DynamoDB's 1MB limit per scan)
    do {
      let result;

      if (clinicId) {
        // Query by specific clinic - no limit
        result = await docClient.send(new QueryCommand({
          TableName: LEASE_TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `CLINIC#${clinicId}`, ':sk': 'LEASE#' },
          ExclusiveStartKey: lastEvaluatedKey
        }));
      } else {
        // Scan all leases across all clinics - no limit
        result = await docClient.send(new ScanCommand({
          TableName: LEASE_TABLE_NAME,
          FilterExpression: 'begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':sk': 'LEASE#' },
          ExclusiveStartKey: lastEvaluatedKey
        }));
      }

      if (result.Items) {
        allLeases = allLeases.concat(result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    let leases = allLeases;

    // Filter out deleted leases (always exclude deleted unless explicitly requested)
    if (!includeDeleted) {
      leases = leases.filter((lease: any) => lease.status !== 'Deleted');
    }

    // Sort by creation date (newest first)
    leases.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Completely flatten all lease data for easy frontend access
    const flattenedData = leases.map((lease: any) => {
      // Extract IDs from keys
      const clinicId = lease.propertyInformation?.clinicId || lease.PK?.replace('CLINIC#', '');
      const leaseId = lease.SK?.replace('LEASE#', '');
      
      return {
        // Primary keys
        clinicId,
        leaseId,
        PK: lease.PK,
        SK: lease.SK,
        entityType: lease.entityType,
        
        // Property Information (flattened)
        clinicName: lease.propertyInformation?.clinicName || '',
        practiceId: lease.propertyInformation?.practiceId || '',
        propertyId: lease.propertyInformation?.propertyId || '',
        address: lease.propertyInformation?.address || '',
        addressLine2: lease.propertyInformation?.addressLine2 || '',
        city: lease.propertyInformation?.city || '',
        state: lease.propertyInformation?.state || '',
        zip: lease.propertyInformation?.zip || '',
        propertyType: lease.propertyInformation?.propertyType || '',
        landlord: lease.propertyInformation?.landlord || '',
        propertyManager: lease.propertyInformation?.propertyManager || '',
        parkingSpaces: lease.propertyInformation?.parkingSpaces || '',
        
        // Financial Details (flattened)
        currentRentInclCAM: lease.financialDetails?.currentRentInclCAM || 0,
        baseRent: lease.financialDetails?.baseRent || 0,
        baseRentPerSqFt: lease.financialDetails?.baseRentPerSqFt || 0,
        camCharges: lease.financialDetails?.camCharges || 0,
        maintenanceCharges: lease.financialDetails?.maintenanceCharges || 0,
        realEstateTaxes: lease.financialDetails?.realEstateTaxes || 0,
        utilities: lease.financialDetails?.utilities || 0,
        insurance: lease.financialDetails?.insurance || 0,
        totalLeaseLiability: lease.financialDetails?.totalLeaseLiability || 0,
        securityDeposit: lease.financialDetails?.securityDeposit || 0,
        depositRefundable: lease.financialDetails?.depositRefundable || false,
        
        // Lease Terms (flattened)
        originalLeaseDate: lease.leaseTerms?.originalLeaseDate || '',
        startDate: lease.leaseTerms?.startDate || '',
        endDate: lease.leaseTerms?.endDate || '',
        termLength: lease.leaseTerms?.termLength || '',
        leaseType: lease.leaseTerms?.leaseType || '',
        status: lease.leaseTerms?.status || lease.status || '',
        sqft: lease.leaseTerms?.sqft || 0,
        totalSqft: lease.leaseTerms?.totalSqft || 0,
        renewalRequestStartDate: lease.leaseTerms?.renewalRequestStartDate || '',
        renewalRequestEndDate: lease.leaseTerms?.renewalRequestEndDate || '',
        renewalTerms: lease.leaseTerms?.renewalTerms || '',
        
        // Renewal Information (flattened)
        renewalRequestStart: lease.renewalInformation?.requestStartDate || '',
        renewalFinalDate: lease.renewalInformation?.finalDate || '',
        renewalSubmissionDate: lease.renewalInformation?.submissionDate || '',
        
        // Payment Terms (flattened)
        rentDueDate: lease.paymentTerms?.rentDueDate || '',
        lateCharges: lease.paymentTerms?.lateCharges || '',
        interestRate: lease.paymentTerms?.interestRate || '',
        failedCheckFee: lease.paymentTerms?.failedCheckFee || '',
        
        // Clauses (flattened)
        exclusiveUse: lease.clauses?.exclusiveUse || '',
        daysOfOperation: lease.clauses?.daysOfOperation || '',
        assignmentFee: lease.clauses?.assignmentFee || 0,
        guaranteeType: lease.clauses?.guaranteeType || '',
        
        // Hidden Charges (flattened)
        signageFee: lease.hiddenCharges?.signageFee || 0,
        trashPickup: lease.hiddenCharges?.trashPickup || 0,
        marketingFund: lease.hiddenCharges?.marketingFund || 0,
        snowRemoval: lease.hiddenCharges?.snowRemoval || 0,
        merchantAssociationFee: lease.hiddenCharges?.merchantAssociationFee || 0,
        
        // Notes and Remarks (flattened)
        notes: lease.notesAndRemarks?.notes || '',
        remarks: lease.notesAndRemarks?.remarks || '',
        
        // Convenience: rent alias for table display
        rent: lease.financialDetails?.currentRentInclCAM || lease.financialDetails?.baseRent || 0,
        
        // Counts for quick reference
        documentsCount: lease.documents?.length || 0,
        assetsCount: lease.assets?.length || 0,
        eventsCount: lease.events?.length || 0,
        contactsCount: lease.contacts?.length || 0,
        
        // Arrays (keep as arrays - can't flatten)
        documents: lease.documents || [],
        assets: lease.assets || [],
        events: lease.events || [],
        contacts: lease.contacts || [],
        
        // Custom fields (spread at top level)
        ...lease.customFields,
        
        // Also spread any custom fields from nested objects
        ...(lease.propertyInformation ? 
          Object.fromEntries(
            Object.entries(lease.propertyInformation).filter(([key]) => 
              !['clinicId', 'clinicName', 'practiceId', 'propertyId', 'address', 'addressLine2', 
               'city', 'state', 'zip', 'propertyType', 'landlord', 'propertyManager', 'parkingSpaces'].includes(key)
            )
          ) : {}
        ),
        ...(lease.financialDetails ? 
          Object.fromEntries(
            Object.entries(lease.financialDetails).filter(([key]) => 
              !['currentRentInclCAM', 'baseRent', 'baseRentPerSqFt', 'camCharges', 'maintenanceCharges',
               'realEstateTaxes', 'utilities', 'insurance', 'totalLeaseLiability', 'securityDeposit', 'depositRefundable'].includes(key)
            )
          ) : {}
        ),
        ...(lease.leaseTerms ? 
          Object.fromEntries(
            Object.entries(lease.leaseTerms).filter(([key]) => 
              !['originalLeaseDate', 'startDate', 'endDate', 'termLength', 'leaseType', 'status', 
               'sqft', 'totalSqft', 'renewalRequestStartDate', 'renewalRequestEndDate', 'renewalTerms'].includes(key)
            )
          ) : {}
        ),
        
        // Timestamps and audit info
        createdAt: lease.createdAt,
        updatedAt: lease.updatedAt,
        createdBy: lease.createdBy || '',
        lastModifiedBy: lease.lastModifiedBy || '',
        deletedBy: lease.deletedBy,
        deletedAt: lease.deletedAt,
      };
    });

    return createResponse(200, {
      success: true,
      data: flattenedData,
      count: flattenedData.length
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
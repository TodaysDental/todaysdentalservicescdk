/**
 * Admin API: Get current user endpoint
 * Returns information about the currently authenticated user
 * 
 * Routes:
 * - GET /me - Get current user info
 * - GET /me/clinics - Get clinics assigned to current user
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { StaffUser } from '../../shared/types/user';
import { clinics as allClinics } from '../../infrastructure/configs/clinics';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const STAFF_USER_TABLE = process.env.STAFF_USER_TABLE || 'StaffUser';
const STAFF_INFO_TABLE = process.env.STAFF_CLINIC_INFO_TABLE;

type StaffClinicDetail = {
  clinicId: string;
  UserNum?: number;
  UserName?: string;
  EmployeeNum?: number;
  employeeName?: string;
  ProviderNum?: string;
  providerName?: string;
  ClinicNum?: string;
  hourlyPay?: string | number;
};

/**
 * Main handler
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    // Get user context from custom authorizer
    const userEmail = event.requestContext.authorizer?.email || '';
    const givenName = event.requestContext.authorizer?.givenName || '';
    const familyName = event.requestContext.authorizer?.familyName || '';
    const clinicRoles = JSON.parse(event.requestContext.authorizer?.clinicRoles || '[]');
    const isSuperAdmin = event.requestContext.authorizer?.isSuperAdmin === 'true';
    const isGlobalSuperAdmin = event.requestContext.authorizer?.isGlobalSuperAdmin === 'true';
    
    // Extract clinic IDs from clinic roles
    const clinicIds = clinicRoles.map((cr: any) => cr.clinicId);

    if (!userEmail) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // Get full user details from DynamoDB
    const userResult = await ddb.send(new GetCommand({
      TableName: STAFF_USER_TABLE,
      Key: { email: userEmail.toLowerCase() },
    }));

    const user = userResult.Item as StaffUser | undefined;

    if (!user) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'User not found' }),
      };
    }

    // Get staff clinic details
    const staffDetails = STAFF_INFO_TABLE ? await getStaffInfoFromDynamoDB(userEmail) : [];

    // Build roles by clinic map (per-clinic roles!)
    const rolesByClinic: Record<string, string[]> = {};

    // If user is super admin, give them all roles for all clinics
    if (isGlobalSuperAdmin || isSuperAdmin) {
      const allClinicIds = isGlobalSuperAdmin 
        ? allClinics.map(c => c.clinicId)
        : clinicIds;

      for (const clinicId of allClinicIds) {
        rolesByClinic[clinicId] = ['Admin', 'SuperAdmin'];
      }
    } else {
      // For regular users, map their per-clinic roles
      for (const cr of clinicRoles) {
        if (!rolesByClinic[cr.clinicId]) {
          rolesByClinic[cr.clinicId] = [];
        }
        rolesByClinic[cr.clinicId].push(cr.role);
      }

      // Also add clinics from staff details (if not already in rolesByClinic)
      for (const detail of staffDetails) {
        if (!rolesByClinic[detail.clinicId]) {
          rolesByClinic[detail.clinicId] = ['patient coordinator']; // Default role
        }
      }
    }

    // Determine which clinics to show
    const userClinicIds = isGlobalSuperAdmin
      ? allClinics.map(c => c.clinicId)
      : Array.from(new Set([...clinicIds, ...staffDetails.map(d => d.clinicId)]));

    // Build clinic objects with COMPLETE access level information
    const clinicIdSet = new Set(userClinicIds);
    const clinics = allClinics
      .filter(c => clinicIdSet.has(c.clinicId))
      .map(c => {
        // Find this clinic's role and permissions
        const clinicRole = clinicRoles.find((cr: any) => cr.clinicId === c.clinicId);
        
        // Build complete access info
        return {
          clinicId: c.clinicId,
          clinicName: c.clinicName,
          clinicPhone: c.clinicPhone,
          clinicAddress: c.clinicAddress,
          
          // Role information
          role: clinicRole?.role || 'patient coordinator',
          roles: rolesByClinic[c.clinicId] || [], // Legacy format
          
          // Module-level permissions
          moduleAccess: clinicRole?.moduleAccess || [],
          
          // Detailed access breakdown
          accessLevel: buildAccessLevel(clinicRole, isSuperAdmin, isGlobalSuperAdmin),
        };
      });

    // Check if request is for /me/clinics specifically
    if (event.resource?.endsWith('/me/clinics') || event.path?.endsWith('/me/clinics')) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ 
          clinics,
          isSuperAdmin,
          isGlobalSuperAdmin,
          totalClinics: clinics.length,
        }),
      };
    }

    // Return full user info for /me route
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        cognitoAuthenticated: false, // Legacy field for backward compatibility
        customAuthenticated: true,
        userEmail,
        userId: userEmail, // Use email as userId
        email: userEmail,
        givenName: user.givenName,
        familyName: user.familyName,
        clinicRoles: user.clinicRoles, // Per-clinic role assignments
        clinics,
        isSuperAdmin: user.isSuperAdmin,
        isGlobalSuperAdmin: user.isGlobalSuperAdmin,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        staffDetails,
        rolesByClinic,
      }),
    };
  } catch (err: any) {
    console.error('Error in /me endpoint:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err?.message || 'Internal Server Error' }),
    };
  }
};

/**
 * Build detailed access level information for a clinic
 */
function buildAccessLevel(
  clinicRole: any,
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): Record<string, any> {
  // Super admins have full access to everything
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return {
      isAdmin: true,
      isSuperAdmin: true,
      modules: {
        HR: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
        Accounting: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
        Operations: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
        Finance: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
        Marketing: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
        Insurance: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
        IT: { canRead: true, canCreate: true, canUpdate: true, canDelete: true },
      },
      summary: 'Full administrative access to all modules',
    };
  }

  // Regular users - check their specific permissions
  const moduleAccess = clinicRole?.moduleAccess || [];
  const modules: Record<string, any> = {};
  
  for (const ma of moduleAccess) {
    modules[ma.module] = {
      canRead: ma.permissions.includes('read'),
      canCreate: ma.permissions.includes('write'),
      canUpdate: ma.permissions.includes('put'),
      canDelete: ma.permissions.includes('delete'),
      permissions: ma.permissions, // Raw permissions array
    };
  }

  // Determine if user has admin-like access
  const isAdmin = clinicRole?.role === 'Admin' || clinicRole?.role === 'SuperAdmin';
  const hasModuleAccess = moduleAccess.length > 0;
  
  // Build summary
  const moduleCount = Object.keys(modules).length;
  let summary = '';
  
  if (moduleCount === 0) {
    summary = 'Basic access - no specific module permissions';
  } else if (moduleCount === 1) {
    summary = `Access to ${moduleCount} module`;
  } else {
    summary = `Access to ${moduleCount} modules`;
  }

  return {
    isAdmin,
    isSuperAdmin: false,
    modules,
    moduleCount,
    summary,
  };
}

/**
 * Get staff clinic information from DynamoDB
 */
async function getStaffInfoFromDynamoDB(email: string): Promise<StaffClinicDetail[]> {
  if (!STAFF_INFO_TABLE) return [];

  try {
    const result = await ddb.send(new QueryCommand({
      TableName: STAFF_INFO_TABLE,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email.toLowerCase(),
      },
    }));

    return (result.Items || []) as StaffClinicDetail[];
  } catch (err) {
    console.error(`Failed to get staff info for ${email}:`, err);
    return [];
  }
}

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { buildCorsHeaders } from '../../shared/utils/cors';
import { CognitoIdentityProviderClient, AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { clinics as allClinics } from '../../infrastructure/configs/clinics';

function getGroupsFromClaims(claims: Record<string, any>): string[] {
  if (!claims) return [];
  const raw = (claims as any)['cognito:groups'] ?? (claims as any)['cognito:groups[]'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    try {
      const maybeArray = JSON.parse(trimmed);
      if (Array.isArray(maybeArray)) return maybeArray as string[];
    } catch {}
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const corsHeaders = buildCorsHeaders({}, event.headers?.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  try {
    const claims = (event.requestContext as any)?.authorizer?.claims || {};
    const xIsSuperAdmin = String(claims['x_is_super_admin'] || '').toLowerCase() === 'true';
    const xClinics = String(claims['x_clinics'] || '').trim();
    const xRbc = String(claims['x_rbc'] || '').trim();

    let groups = getGroupsFromClaims(claims);
    // Fallback: If no groups in claims, fetch from Cognito
    if ((!groups || groups.length === 0) && claims.sub && process.env.USER_POOL_ID) {
      try {
        const cognito = new CognitoIdentityProviderClient({});
        const listed = await cognito.send(new AdminListGroupsForUserCommand({
          UserPoolId: process.env.USER_POOL_ID,
          Username: claims.sub,
        }));
        groups = (listed.Groups || []).map((g) => String(g.GroupName || '')).filter(Boolean);
      } catch {}
    }
    const groupsContainSuperAdmin = groups.some((g) => g === 'GLOBAL__SUPER_ADMIN');
    const isSuperAdmin = xIsSuperAdmin || groupsContainSuperAdmin;

    let clinicIds: string[] = [];
    if (isSuperAdmin || xClinics === 'ALL') {
      clinicIds = allClinics.map((c) => c.clinicId);
    } else if (xClinics) {
      clinicIds = xClinics.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (xRbc) {
      clinicIds = xRbc.split(',').map((pair) => pair.split(':')[0]).filter(Boolean);
    } else if (groups.length > 0) {
      // Derive from group names e.g., clinic_123__ADMIN
      clinicIds = groups
        .map((name) => {
          const match = /^clinic_([^_][^\s]*)__[A-Z_]+$/.exec(String(name));
          return match ? match[1] : '';
        })
        .filter(Boolean);
    }

    // Extract roles for each clinic from groups
    const rolesByClinic: Record<string, string[]> = {};
    
    // If user is super admin, give them all roles for all clinics
    if (isSuperAdmin) {
      for (const clinicId of clinicIds) {
        rolesByClinic[clinicId] = ['SUPER_ADMIN', 'ADMIN', 'PROVIDER', 'MARKETING', 'USER'];
      }
    } else {
      // Parse roles from groups for regular users
      for (const group of groups) {
        if (group === 'GLOBAL__SUPER_ADMIN') {
          // This case should already be handled above, but keeping for safety
          for (const clinicId of clinicIds) {
            rolesByClinic[clinicId] = ['SUPER_ADMIN', 'ADMIN', 'PROVIDER', 'MARKETING', 'USER'];
          }
          continue;
        }
        // Match pattern: clinic_{clinicId}__{ROLE}
        const match = /^clinic_([^_][^\s]*)__([A-Z_]+)$/.exec(group);
        if (match) {
          const clinicId = match[1];
          const role = match[2];
          if (clinicIds.includes(clinicId)) {
            if (!rolesByClinic[clinicId]) {
              rolesByClinic[clinicId] = [];
            }
            rolesByClinic[clinicId].push(role);
          }
        }
      }
    }

    const clinicIdSet = new Set(clinicIds);
    const clinics = allClinics
      .filter((c) => clinicIdSet.has(c.clinicId))
      .map((c) => ({
        clinicId: c.clinicId,
        clinicName: c.clinicName,
        clinicPhone: c.clinicPhone,  // Display phone number
        roles: rolesByClinic[c.clinicId] || ['USER'] // Default to USER role if none found
      }));

    if (event.resource?.endsWith('/me/clinics')) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ clinics }),
      };
    } else {
      // Return basic user info for /me route
      const userEmail = claims.email || '';
      const userId = claims.sub || '';
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          cognitoAuthenticated: true,
          userEmail: userEmail,
          userId: userId,
          clinics
        }),
      };
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err?.message || 'Internal Server Error' }),
    };
  }
};



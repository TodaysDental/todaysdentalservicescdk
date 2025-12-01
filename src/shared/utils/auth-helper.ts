/**
 * Shared authentication helper for Chime, Analytics, and Communication services
 * Uses custom JWT tokens (not Cognito)
 */

import { verifyToken, JWTPayload } from './jwt';

export interface AuthVerificationResult {
  ok: boolean;
  payload?: JWTPayload;
  code?: number;
  message?: string;
}

/**
 * Verify ID token from Authorization header
 * @param authorizationHeader - The Authorization header value (e.g., "Bearer <token>")
 * @returns Verification result with payload or error
 */
export async function verifyIdToken(
  authorizationHeader: string
): Promise<AuthVerificationResult> {
  if (!authorizationHeader || !authorizationHeader.toLowerCase().startsWith('bearer ')) {
    return { ok: false, code: 401, message: 'Missing Bearer token' };
  }

  const token = authorizationHeader.slice(7).trim();
  
  try {
    const payload = await verifyToken(token);
    
    // Ensure it's an access token (not refresh token)
    if (payload.type !== 'access') {
      return { ok: false, code: 401, message: 'Access token required' };
    }
    
    return { ok: true, payload };
  } catch (err: any) {
    return { ok: false, code: 401, message: `Invalid token: ${err.message}` };
  }
}

/**
 * Get clinic IDs from JWT payload
 * Note: With the new auth system, clinic roles are fetched from the authorizer context,
 * not from JWT claims. This is a fallback for direct lambda invocations.
 * 
 * @param payload - JWT payload
 * @returns Array of clinic IDs the user has access to, or ['ALL'] for super admins
 */
export function getClinicsFromPayload(payload: JWTPayload): string[] {
  // Super admins have access to all clinics
  if (payload.isGlobalSuperAdmin || payload.isSuperAdmin) {
    return ['ALL'];
  }
  
  // For non-admin users, clinic roles should be fetched from the authorizer context
  // or from DynamoDB (StaffClinicInfo table)
  // This is a fallback that returns empty array
  return [];
}

/**
 * Extract user ID from JWT payload
 * @param payload - JWT payload
 * @returns User ID (email)
 */
export function getUserId(payload: JWTPayload): string {
  return payload.sub || payload.email;
}

/**
 * Check if user is super admin
 * @param payload - JWT payload
 * @returns True if user is super admin
 */
export function isSuperAdmin(payload: JWTPayload): boolean {
  return payload.isGlobalSuperAdmin || payload.isSuperAdmin;
}


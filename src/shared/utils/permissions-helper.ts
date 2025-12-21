/**
 * Shared permissions helper for all services
 * Provides consistent user permission checking across the application
 * 
 * Supports two modes:
 * 1. API Gateway Authorizer context (for REST APIs like callbacks, admin)
 * 2. Direct JWT payload (for Chime real-time services)
 */

import { APIGatewayProxyEvent } from 'aws-lambda';
import { JWTPayload } from './jwt';

/**
 * User permissions extracted from the authorizer context or JWT payload
 */
export interface UserPermissions {
  email: string;
  givenName: string;
  familyName: string;
  clinicRoles: ClinicRole[];
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
}

/**
 * Authorization result for clinic access checks
 */
export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
}

/**
 * Clinic role with module access permissions
 */
export interface ClinicRole {
  clinicId: string;
  role: string;
  moduleAccess?: ModuleAccessEntry[];
}

/**
 * Module access entry with CRUD permissions
 */
export interface ModuleAccessEntry {
  module: string;
  permissions: PermissionType[];
}

export type PermissionType = 'read' | 'write' | 'put' | 'delete';

/**
 * System modules available in the application
 */
export const SYSTEM_MODULES = [
  'HR',
  'Accounting',
  'Operations',
  'Finance',
  'Marketing',
  'Legal',
  'IT',
] as const;

export type SystemModule = typeof SYSTEM_MODULES[number];

/**
 * Get user's clinic roles and permissions from custom authorizer context
 * @param event - API Gateway event with authorizer context
 * @returns User permissions or null if not authenticated
 */
export function getUserPermissions(event: APIGatewayProxyEvent): UserPermissions | null {
  const authorizer = event.requestContext?.authorizer;
  if (!authorizer) return null;

  try {
    const clinicRoles = JSON.parse(authorizer.clinicRoles || '[]') as ClinicRole[];
    const isSuperAdmin = authorizer.isSuperAdmin === 'true';
    const isGlobalSuperAdmin = authorizer.isGlobalSuperAdmin === 'true';
    const email = authorizer.email || '';
    const givenName = authorizer.givenName || '';
    const familyName = authorizer.familyName || '';

    return {
      email,
      givenName,
      familyName,
      clinicRoles,
      isSuperAdmin,
      isGlobalSuperAdmin,
    };
  } catch (err) {
    console.error('Failed to parse user permissions:', err);
    return null;
  }
}

/**
 * Check if user has admin role (Admin, SuperAdmin, or Global Super Admin)
 * @param clinicRoles - User's clinic role assignments
 * @param isSuperAdmin - SuperAdmin flag from authorizer
 * @param isGlobalSuperAdmin - GlobalSuperAdmin flag from authorizer
 * @returns True if user is an admin
 */
export function isAdminUser(
  clinicRoles: ClinicRole[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): boolean {
  // Check flags first
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return true;
  }

  // Check if user has Admin or SuperAdmin role at any clinic
  for (const cr of clinicRoles) {
    if (cr.role === 'Admin' || cr.role === 'SuperAdmin' || cr.role === 'Global super admin') {
      return true;
    }
  }

  return false;
}

/**
 * Check if user has specific permission for a module at a clinic
 * @param clinicRoles - User's clinic role assignments
 * @param clinicId - Target clinic ID (optional, checks any clinic if not provided)
 * @param module - Target module name
 * @param permission - Required permission (read, write, put, delete)
 * @param isSuperAdmin - SuperAdmin flag
 * @param isGlobalSuperAdmin - GlobalSuperAdmin flag
 * @returns True if user has the permission
 */
export function hasModulePermission(
  clinicRoles: ClinicRole[],
  module: string,
  permission: PermissionType,
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  clinicId?: string
): boolean {
  // Admin, SuperAdmin, and Global Super Admin have all permissions
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return true;
  }

  // Check if user has the permission for this module at the specified clinic (or any clinic)
  for (const cr of clinicRoles) {
    // If clinicId is specified, check only that clinic
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }

    const moduleAccess = cr.moduleAccess?.find((ma) => ma.module === module);
    if (moduleAccess && moduleAccess.permissions.includes(permission)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all clinic IDs user has access to
 * @param clinicRoles - User's clinic role assignments
 * @param isSuperAdmin - SuperAdmin flag
 * @param isGlobalSuperAdmin - GlobalSuperAdmin flag
 * @returns Set of clinic IDs (contains '*' for super admins with access to all clinics)
 */
export function getAllowedClinicIds(
  clinicRoles: ClinicRole[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean
): Set<string> {
  // Super admins have access to all clinics
  if (isGlobalSuperAdmin || isSuperAdmin) {
    return new Set<string>(['*']);
  }

  // Extract clinic IDs from clinic roles
  const clinicIds = clinicRoles.map((cr) => cr.clinicId);
  return new Set<string>(clinicIds);
}

/**
 * Check if user has access to a specific clinic
 * @param allowedClinics - Set of allowed clinic IDs (from getAllowedClinicIds)
 * @param clinicId - Target clinic ID to check
 * @returns True if user has access to the clinic
 */
export function hasClinicAccess(allowedClinics: Set<string>, clinicId: string): boolean {
  return allowedClinics.has('*') || allowedClinics.has(clinicId);
}

/**
 * Get all modules user has access to (with at least read permission)
 * @param clinicRoles - User's clinic role assignments
 * @param isSuperAdmin - SuperAdmin flag
 * @param isGlobalSuperAdmin - GlobalSuperAdmin flag
 * @param clinicId - Optional clinic ID to filter by
 * @returns Array of accessible module names
 */
export function getAccessibleModules(
  clinicRoles: ClinicRole[],
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  clinicId?: string
): string[] {
  // Admin, SuperAdmin, and Global Super Admin have access to all modules
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return [...SYSTEM_MODULES];
  }

  const accessibleModules = new Set<string>();

  for (const cr of clinicRoles) {
    // If clinicId is specified, check only that clinic
    if (clinicId && cr.clinicId !== clinicId) {
      continue;
    }

    if (cr.moduleAccess) {
      for (const ma of cr.moduleAccess) {
        if (ma.permissions && ma.permissions.includes('read')) {
          accessibleModules.add(ma.module);
        }
      }
    }
  }

  return Array.from(accessibleModules);
}

/**
 * Filter items based on user's module access
 * @param items - Array of items with a 'module' property
 * @param clinicRoles - User's clinic role assignments
 * @param clinicId - Target clinic ID
 * @param isSuperAdmin - SuperAdmin flag
 * @param isGlobalSuperAdmin - GlobalSuperAdmin flag
 * @param defaultModule - Default module for items without a module property
 * @returns Filtered array of items user can access
 */
export function filterByModuleAccess<T extends { module?: string }>(
  items: T[],
  clinicRoles: ClinicRole[],
  clinicId: string,
  isSuperAdmin: boolean,
  isGlobalSuperAdmin: boolean,
  defaultModule: string = 'Operations'
): T[] {
  // Admins see all items
  if (isAdminUser(clinicRoles, isSuperAdmin, isGlobalSuperAdmin)) {
    return items;
  }

  // Get accessible modules for this clinic
  const accessibleModules = new Set(
    getAccessibleModules(clinicRoles, isSuperAdmin, isGlobalSuperAdmin, clinicId)
  );

  // Filter items to only show those in accessible modules
  return items.filter((item) => {
    const itemModule = item.module || defaultModule;
    return accessibleModules.has(itemModule);
  });
}

/**
 * Get user display name (givenName or email)
 * @param permissions - User permissions object
 * @returns Display name for the user
 */
export function getUserDisplayName(permissions: UserPermissions): string {
  return permissions.givenName || permissions.email || 'system';
}

// ============================================================================
// JWT PAYLOAD FUNCTIONS (for Chime and real-time services)
// ============================================================================

/**
 * Extract clinic IDs from JWT claims
 * Supports multiple claim formats for backward compatibility
 * @param payload - JWT payload (from jose or custom JWT)
 * @returns Array of clinic IDs or ['ALL'] for super admins
 */
export function getClinicsFromJwtPayload(payload: JWTPayload | Record<string, any>): string[] {
  // Check if super admin first
  if ((payload as any).isGlobalSuperAdmin || (payload as any).isSuperAdmin) {
    return ['ALL'];
  }

  // Try x_clinics claim (custom format)
  const xClinics = String((payload as any)['x_clinics'] || '').trim();
  if (xClinics === 'ALL') return ['ALL'];
  if (xClinics) {
    return xClinics.split(',').map((s) => s.trim()).filter(Boolean);
  }

  // Try x_rbc claim (role-based clinics format: "clinicId:role,clinicId:role")
  const xRbc = String((payload as any)['x_rbc'] || '').trim();
  if (xRbc) {
    return xRbc.split(',').map((pair) => pair.split(':')[0]).filter(Boolean);
  }

  // Try Cognito groups (format: clinic_<clinicId>__<ROLE>)
  const groups = Array.isArray((payload as any)['cognito:groups'])
    ? ((payload as any)['cognito:groups'] as string[])
    : [];
  if (groups.length > 0) {
    const clinicIds = groups
      .map((name) => {
        const nameStr = String(name);
        if (nameStr.length > 200) return ''; // Reject malformed input
        const match = /^clinic_([a-zA-Z0-9_-]+)__[A-Z_]+$/.exec(nameStr);
        return match ? match[1] : '';
      })
      .filter(Boolean);
    if (clinicIds.length > 0) {
      return clinicIds;
    }
  }

  return [];
}

/**
 * Check if user has access to a specific clinic using JWT claims
 * @param authorizedClinics - Array of clinic IDs user has access to
 * @param requestedClinic - Target clinic ID
 * @returns True if user has access
 */
export function hasClinicAccessFromJwt(
  authorizedClinics: string[],
  requestedClinic: string
): boolean {
  return authorizedClinics[0] === 'ALL' || authorizedClinics.includes(requestedClinic);
}

/**
 * Check clinic authorization from JWT payload
 * Use this in Chime services for consistent authorization
 * @param payload - JWT payload
 * @param clinicId - Target clinic ID
 * @returns Authorization result with reason if denied
 */
export function checkClinicAuthorization(
  payload: JWTPayload | Record<string, any>,
  clinicId: string
): AuthorizationResult {
  const authorizedClinics = getClinicsFromJwtPayload(payload);

  if (authorizedClinics.length === 0) {
    return {
      authorized: false,
      reason: 'No clinic access configured for user',
    };
  }

  if (!hasClinicAccessFromJwt(authorizedClinics, clinicId)) {
    return {
      authorized: false,
      reason: `Not authorized for clinic ${clinicId}`,
    };
  }

  return { authorized: true };
}

/**
 * Check if JWT payload indicates super admin
 * @param payload - JWT payload
 * @returns True if user is super admin
 */
export function isSuperAdminFromJwt(payload: JWTPayload | Record<string, any>): boolean {
  return (payload as any).isGlobalSuperAdmin === true || (payload as any).isSuperAdmin === true;
}

/**
 * Get user ID from JWT payload
 * @param payload - JWT payload
 * @returns User ID (email or sub)
 */
export function getUserIdFromJwt(payload: JWTPayload | Record<string, any>): string {
  return (payload as any).sub || (payload as any).email || '';
}


/**
 * User roles in the system
 */
export const USER_ROLES = [
  'Accounting',
  'patient coordinator',
  'treatment coordinator',
  'patient coordinator (remote)',
  'Regional manager',
  'Office Manager',
  'Marketing',
  'Insurance',
  'Payment Posting',
  'Credentialing',
  'Admin',
  'SuperAdmin',
  'Global super admin',
] as const;

export type UserRole = typeof USER_ROLES[number];

/**
 * System modules with granular permissions
 */
export const SYSTEM_MODULES = [
  'HR',
  'Accounting',
  'Operations',
  'Finance',
  'Marketing',
  'Insurance',
  'IT',
] as const;

export type SystemModule = typeof SYSTEM_MODULES[number];

/**
 * CRUD operations for module permissions
 */
export const MODULE_PERMISSIONS = [
  'read',
  'write',
  'put',
  'delete',
] as const;

export type ModulePermission = typeof MODULE_PERMISSIONS[number];

/**
 * Module permissions for a specific module
 */
export interface ModuleAccess {
  module: SystemModule;
  permissions: ModulePermission[]; // e.g., ['read', 'write', 'put', 'delete']
}

/**
 * Clinic-specific role assignment with module permissions
 */
export interface ClinicRoleAssignment {
  clinicId: string;
  role: UserRole;
  moduleAccess?: ModuleAccess[]; // Optional - granular module permissions per clinic
}

/**
 * Staff user stored in DynamoDB
 */
export interface StaffUser {
  email: string; // Partition key
  passwordHash?: string; // Optional - for backward compatibility or admin-set passwords
  givenName?: string;
  familyName?: string;
  clinicRoles: ClinicRoleAssignment[]; // Per-clinic role assignments
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  isActive: boolean;
  emailVerified: boolean;
  // OTP fields
  otpCode?: string; // Current OTP code
  otpExpiry?: number; // Unix timestamp when OTP expires
  otpAttempts?: number; // Number of failed OTP attempts
  otpLastSent?: number; // Unix timestamp of last OTP sent (for rate limiting)
  // Legacy fields
  verificationCode?: string;
  verificationCodeExpiry?: number;
  refreshToken?: string;
  refreshTokenExpiry?: number;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  // Additional dental staff attributes
  hourlyPay?: string;
  opendentalUsernum?: string;
  opendentalUsername?: string;
}

/**
 * User data returned from API (without sensitive fields)
 */
export interface PublicStaffUser {
  email: string;
  givenName?: string;
  familyName?: string;
  clinicRoles: ClinicRoleAssignment[]; // Per-clinic role assignments
  isSuperAdmin: boolean;
  isGlobalSuperAdmin: boolean;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
}


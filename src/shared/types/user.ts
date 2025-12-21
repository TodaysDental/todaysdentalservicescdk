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
  'Dentist',
  'Dental Hygienist',
  'Front Desk',
  'Dental Assistant',
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
  'Legal',
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
 * Work location configuration
 */
export interface WorkLocation {
  isRemote: boolean;
  isOnPremise: boolean;
}

/**
 * Clinic-specific role assignment with module permissions
 */
export interface ClinicRoleAssignment {
  clinicId: string;
  role: UserRole;
  basePay?: number; // Annual base pay in dollars
  workLocation?: WorkLocation; // Remote/on-premise configuration
  hourlyPay?: number; // Hourly pay rate in dollars
  openDentalUserNum?: number; // Open Dental user number
  openDentalUsername?: string; // Open Dental username
  employeeNum?: number; // Employee number
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
  // Login rate limiting fields
  loginAttempts?: number; // Number of failed password login attempts
  lockoutUntil?: number; // Unix timestamp when account lockout expires
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
  // User email credentials (todaysdentalservices.com)
  userEmail?: UserEmailCredentials;
}

/**
 * User-specific email credentials for todaysdentalservices.com
 * Created during user registration
 */
export interface UserEmailCredentials {
  email: string;           // e.g., john.doe@todaysdentalservices.com
  password: string;        // Email password (encrypted in transit)
  imapHost: string;        // e.g., mail.todaysdentalservices.com
  imapPort: number;        // e.g., 993 (SSL)
  smtpHost: string;        // e.g., mail.todaysdentalservices.com
  smtpPort: number;        // e.g., 465 (SSL)
  createdAt?: string;      // When the email was created
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


/**
 * @deprecated This file is DEPRECATED. Use the secrets-helper utility instead.
 * 
 * Clinic data is now stored in three DynamoDB tables:
 * 1. ClinicSecrets - Sensitive credentials (API keys, passwords)
 * 2. GlobalSecrets - System-wide secrets (Ayrshare, Odoo, Gmail, Twilio)
 * 3. ClinicConfig - Non-sensitive configuration (addresses, phone numbers, etc.)
 * 
 * Usage:
 *   import { getClinicConfig, getClinicSecrets, getGlobalSecret } from '../../shared/utils/secrets-helper';
 *   
 *   // Get clinic configuration
 *   const config = await getClinicConfig('dentistinnewbritain');
 *   
 *   // Get clinic secrets
 *   const secrets = await getClinicSecrets('dentistinnewbritain');
 *   
 *   // Get global secret
 *   const ayrshareApiKey = await getGlobalSecret('ayrshare', 'api_key');
 * 
 * The bundled JSON is still available for backward compatibility during migration,
 * but all new code should use the DynamoDB-backed secrets-helper utility.
 */

// Use clinic-config.json for non-sensitive configuration data
import clinicConfigData from "./clinic-config.json";

/**
 * Clinic interface - now split between ClinicConfig (non-sensitive) and ClinicSecrets (sensitive)
 * @deprecated Use ClinicConfig and ClinicSecrets from secrets-helper instead
 */
export interface Clinic {
  clinicId: string;
  clinicAddress: string;
  clinicCity: string;
  clinicEmail: string;
  clinicFax?: string;
  clinicName: string;
  clinicPhone: string;
  clinicState: string;
  clinicZipCode?: string;
  CliniczipCode?: string; // Legacy field name
  logoUrl: string;
  mapsUrl?: string;
  scheduleUrl?: string;
  websiteLink: string;
  // Phone number for this clinic (inbound/outbound calls)
  phoneNumber: string;
  // Clinic time zone (IANA), e.g., 'America/New_York'
  timezone?: string;
  timeZone?: string; // Legacy field name
  // Per-clinic messaging identities
  sesIdentityArn?: string;
  smsOriginationArn?: string;
  // SFTP folder path for consolidated Transfer Family setup
  sftpFolderPath?: string;
  // Odoo integration for accounting
  odooCompanyId?: number;
  // Ayrshare configuration (non-sensitive parts)
  ayrshare?: {
    enabled: boolean;
    connectedPlatforms: string[];
    facebook?: {
      connected: boolean;
      pageId: string;
      pageName: string;
    };
  };
  // Email configuration (non-sensitive parts)
  email?: {
    gmail?: {
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
      smtpUser: string;
      fromEmail: string;
      fromName: string;
    };
    domain?: {
      imapHost: string;
      imapPort: number;
      smtpHost: string;
      smtpPort: number;
      smtpUser: string;
      fromEmail: string;
      fromName: string;
    };
  };
  // NOTE: Sensitive fields have been removed - use getClinicSecrets() instead
  // - developerKey -> secrets.openDentalDeveloperKey
  // - customerKey -> secrets.openDentalCustomerKey
  // - authorizeNetApiLoginId -> secrets.authorizeNetApiLoginId
  // - authorizeNetTransactionKey -> secrets.authorizeNetTransactionKey
}

/**
 * @deprecated Use getClinicConfig() and getClinicSecrets() from secrets-helper instead.
 * This export is retained for backward compatibility during migration.
 * NOTE: This now uses clinic-config.json which does NOT include sensitive fields.
 */
export const clinics: Clinic[] = clinicConfigData as Clinic[];

/**
 * @deprecated Use getClinicConfig() from secrets-helper instead.
 * Get clinic by ID from bundled data (for backward compatibility only)
 */
export function getClinicById(clinicId: string): Clinic | undefined {
  console.warn(`[DEPRECATED] getClinicById is deprecated. Use getClinicConfig('${clinicId}') from secrets-helper instead.`);
  return clinics.find(c => c.clinicId === clinicId);
}

/**
 * @deprecated Use getAllClinicConfigs() from secrets-helper instead.
 * Get all clinic IDs from bundled data (for backward compatibility only)
 */
export function getAllClinicIds(): string[] {
  console.warn('[DEPRECATED] getAllClinicIds is deprecated. Use getClinicIds() from secrets-helper instead.');
  return clinics.map(c => c.clinicId);
}

import clinicsData from '../../infrastructure/configs/clinics.json';

/**
 * Standard clinic placeholder interface
 * These placeholders can be used in email/SMS templates
 */
export interface ClinicPlaceholders {
  /** Clinic name - {clinic_name} */
  clinic_name: string;
  /** Clinic phone number - {phone_number} */
  phone_number: string;
  /** Full clinic address - {clinic_address} */
  clinic_address: string;
  /** Clinic website URL - {clinic_url} */
  clinic_url: string;
  /** Clinic email address - {clinic_email} */
  clinic_email: string;
  /** Google Maps URL - {maps_url} */
  maps_url: string;
  /** Schedule/booking URL - {schedule_url} */
  schedule_url: string;
  /** Clinic logo URL - {logo_url} */
  logo_url: string;
  /** Clinic fax number - {fax_number} */
  fax_number: string;
  /** Clinic city - {clinic_city} */
  clinic_city: string;
  /** Clinic state - {clinic_state} */
  clinic_state: string;
  /** Clinic zip code - {clinic_zip} */
  clinic_zip: string;
}

/**
 * Build a complete clinic context with standard placeholders
 * @param clinicId - The clinic ID to look up
 * @returns Record containing all clinic placeholders with their values
 */
export function buildClinicPlaceholders(clinicId: string): Record<string, string> {
  const clinic = (clinicsData as any[]).find((c) => String(c.clinicId) === String(clinicId));
  
  if (!clinic) {
    // Return empty placeholders if clinic not found
    return {
      clinic_name: '',
      phone_number: '',
      clinic_address: '',
      clinic_url: '',
      clinic_email: '',
      maps_url: '',
      schedule_url: '',
      logo_url: '',
      fax_number: '',
      clinic_city: '',
      clinic_state: '',
      clinic_zip: '',
    };
  }

  // Build full address from components
  const addressParts = [
    clinic.clinicAddress || '',
  ].filter(Boolean);
  const fullAddress = addressParts.join(', ');

  // Standard placeholders (snake_case for template compatibility)
  const placeholders: Record<string, string> = {
    // Primary placeholders (as requested)
    clinic_name: String(clinic.clinicName || ''),
    phone_number: String(clinic.clinicPhone || clinic.phoneNumber || ''),
    clinic_address: fullAddress,
    clinic_url: String(clinic.websiteLink || ''),
    clinic_email: String(clinic.clinicEmail || ''),
    maps_url: String(clinic.mapsUrl || ''),
    
    // Additional useful placeholders
    schedule_url: String(clinic.scheduleUrl || ''),
    logo_url: String(clinic.logoUrl || ''),
    fax_number: String(clinic.clinicFax || ''),
    clinic_city: String(clinic.clinicCity || ''),
    clinic_state: String(clinic.clinicState || ''),
    clinic_zip: String(clinic.CliniczipCode || ''),
    
    // Also include original field names for backwards compatibility
    clinicName: String(clinic.clinicName || ''),
    clinicPhone: String(clinic.clinicPhone || ''),
    clinicAddress: String(clinic.clinicAddress || ''),
    clinicEmail: String(clinic.clinicEmail || ''),
    clinicCity: String(clinic.clinicCity || ''),
    clinicState: String(clinic.clinicState || ''),
    CliniczipCode: String(clinic.CliniczipCode || ''),
    clinicFax: String(clinic.clinicFax || ''),
    websiteLink: String(clinic.websiteLink || ''),
    mapsUrl: String(clinic.mapsUrl || ''),
    scheduleUrl: String(clinic.scheduleUrl || ''),
    logoUrl: String(clinic.logoUrl || ''),
    phoneNumber: String(clinic.phoneNumber || ''),
  };

  return placeholders;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render a template string by replacing placeholders with values
 * Supports both {{placeholder}} and {placeholder} syntax
 * 
 * @param template - The template string with placeholders
 * @param context - Key-value pairs for placeholder replacement
 * @returns The rendered string with placeholders replaced
 */
export function renderTemplate(template: string, context: Record<string, string>): string {
  let result = template;
  
  for (const [key, value] of Object.entries(context)) {
    const safeValue = String(value);
    // Support both {{key}} and {key} syntax
    const doubleBraceRegex = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'g');
    const singleBraceRegex = new RegExp(`\\{${escapeRegExp(key)}\\}`, 'g');
    result = result.replace(doubleBraceRegex, safeValue).replace(singleBraceRegex, safeValue);
  }
  
  return result;
}

/**
 * Build a complete context for template rendering
 * Merges clinic placeholders with additional row data (e.g., patient info)
 * 
 * Supports the following patient placeholders (built from row data):
 * - {patient_name} - Full patient name (FName + LName)
 * - {first_name} - Patient first name
 * - {last_name} - Patient last name
 * - {FName} - Patient first name (original field)
 * - {LName} - Patient last name (original field)
 * 
 * @param clinicId - The clinic ID
 * @param additionalData - Additional data to merge (e.g., patient data from query results)
 * @returns Complete context for template rendering
 */
export function buildTemplateContext(
  clinicId: string,
  additionalData?: Record<string, any>
): Record<string, string> {
  const clinicContext = buildClinicPlaceholders(clinicId);
  
  if (!additionalData) {
    return clinicContext;
  }
  
  // Merge additional data, converting all values to strings
  const mergedContext: Record<string, string> = { ...clinicContext };
  for (const [key, value] of Object.entries(additionalData)) {
    if (value !== undefined && value !== null) {
      mergedContext[key] = String(value);
    }
  }
  
  // Build patient_name from FName and LName if available (case-insensitive lookup)
  const fname = String(additionalData.FName || additionalData.fname || additionalData.FirstName || additionalData.firstName || additionalData.first_name || '').trim();
  const lname = String(additionalData.LName || additionalData.lname || additionalData.LastName || additionalData.lastName || additionalData.last_name || '').trim();
  
  // Add patient name placeholders
  if (fname || lname) {
    const fullName = [fname, lname].filter(Boolean).join(' ');
    mergedContext['patient_name'] = fullName;
    mergedContext['first_name'] = fname;
    mergedContext['last_name'] = lname;
    // Also ensure FName and LName are available for backwards compatibility
    if (fname && !mergedContext['FName']) mergedContext['FName'] = fname;
    if (lname && !mergedContext['LName']) mergedContext['LName'] = lname;
  }
  
  return mergedContext;
}

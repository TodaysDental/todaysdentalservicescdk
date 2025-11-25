/**
 * OpenDental API Utility Functions
 * Provides reusable functions for interacting with the OpenDental API
 */

import https from 'https';
import clinicsData from '../../infrastructure/configs/clinics.json';

const API_HOST = 'api.opendental.com';
const API_BASE = '/api/v1';

interface ClinicConfig {
  clinicId: string;
  developerKey: string;
  customerKey: string;
  [key: string]: any;
}

/**
 * Get clinic configuration by ID
 */
export function getClinicConfig(clinicId: string): ClinicConfig | null {
  const clinic = (clinicsData as any[]).find(c => c.clinicId === clinicId);
  if (!clinic) {
    console.error(`Clinic configuration not found for clinicId: ${clinicId}`);
    return null;
  }
  return clinic as ClinicConfig;
}

/**
 * Make a request to the OpenDental API
 */
export async function makeOpenDentalRequest(
  method: string,
  path: string,
  clinicId: string,
  body?: any
): Promise<any> {
  const clinic = getClinicConfig(clinicId);
  if (!clinic) {
    throw new Error(`Clinic configuration not found for ${clinicId}`);
  }

  const headers = {
    'Authorization': `ODFHIR ${clinic.developerKey}/${clinic.customerKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: API_HOST,
      path,
      method,
      headers,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject({
              statusCode: res.statusCode,
              message: parsed.message || data || 'OpenDental API error',
              data: parsed,
            });
          }
        } catch (err) {
          reject({
            statusCode: res.statusCode,
            message: 'Failed to parse OpenDental API response',
            data,
          });
        }
      });
    });

    req.on('error', (err) => {
      reject({
        statusCode: 500,
        message: err.message || 'Network error calling OpenDental API',
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Search for a patient by phone number using OpenDental Patients GET (multiple) endpoint
 */
export async function searchPatientByPhone(
  phoneNumber: string,
  clinicId: string
): Promise<any | null> {
  try {
    // Clean phone number - remove all non-digit characters
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Try different phone number formats
    const phoneFormats = [
      cleanPhone,
      cleanPhone.slice(-10), // Last 10 digits
      cleanPhone.slice(-7),  // Last 7 digits (local number)
    ];

    console.log(`[OpenDental] Searching for patient with phone: ${phoneNumber} (cleaned: ${cleanPhone})`);

    for (const phone of phoneFormats) {
      if (!phone || phone.length < 7) continue;

      const path = `${API_BASE}/patients?Phone=${encodeURIComponent(phone)}`;
      
      try {
        const response = await makeOpenDentalRequest('GET', path, clinicId);
        
        if (Array.isArray(response) && response.length > 0) {
          console.log(`[OpenDental] Found ${response.length} patient(s) for phone ${phone}`);
          // Return the first match
          return response[0];
        }
      } catch (err: any) {
        // If 404, no patients found with this format, try next
        if (err.statusCode === 404) {
          continue;
        }
        throw err;
      }
    }

    console.log(`[OpenDental] No patients found for phone: ${phoneNumber}`);
    return null;
  } catch (error: any) {
    console.error('[OpenDental] Error searching patient by phone:', error);
    throw error;
  }
}

/**
 * Get patient details by PatNum using OpenDental Patients GET (single) endpoint
 */
export async function getPatientByPatNum(
  patNum: number,
  clinicId: string
): Promise<any> {
  try {
    console.log(`[OpenDental] Fetching patient PatNum: ${patNum}`);
    
    const path = `${API_BASE}/patients/${patNum}`;
    const patient = await makeOpenDentalRequest('GET', path, clinicId);
    
    console.log(`[OpenDental] Successfully retrieved patient: ${patient.FName} ${patient.LName}`);
    return patient;
  } catch (error: any) {
    console.error(`[OpenDental] Error fetching patient ${patNum}:`, error);
    throw error;
  }
}

/**
 * Create a commlog entry using OpenDental Commlogs POST (create) endpoint
 */
export async function createCommlog(
  patNum: number,
  note: string,
  clinicId: string,
  options?: {
    commType?: string; // e.g., "Misc", "ApptRelated", etc.
    mode?: 'None' | 'Email' | 'Mail' | 'Phone' | 'In Person' | 'Text' | 'Email and Text' | 'Phone and Text';
    sentOrReceived?: 'Neither' | 'Sent' | 'Received';
    commDateTime?: string; // "yyyy-mm-dd HH:mm:ss"
  }
): Promise<any> {
  try {
    console.log(`[OpenDental] Creating commlog for PatNum: ${patNum}`);
    
    const body: any = {
      PatNum: patNum,
      Note: note,
      Mode_: options?.mode || 'Phone',
      SentOrReceived: options?.sentOrReceived || 'Received',
    };

    // Add optional fields if provided
    if (options?.commType) {
      body.commType = options.commType;
    }
    if (options?.commDateTime) {
      body.CommDateTime = options.commDateTime;
    }

    const path = `${API_BASE}/commlogs`;
    const commlog = await makeOpenDentalRequest('POST', path, clinicId, body);
    
    console.log(`[OpenDental] Successfully created commlog: ${commlog.CommlogNum}`);
    return commlog;
  } catch (error: any) {
    console.error(`[OpenDental] Error creating commlog for patient ${patNum}:`, error);
    throw error;
  }
}

/**
 * Extract PatNum from call metadata
 * Can be from:
 * - callData.patNum (if set by chatbot)
 * - callData.metadata.PatNum
 * - callData.attributes.PatNum
 */
export function extractPatNumFromCallData(callData: any): number | null {
  // Try different possible locations
  const patNum = 
    callData.patNum ||
    callData.PatNum ||
    callData.metadata?.PatNum ||
    callData.metadata?.patNum ||
    callData.attributes?.PatNum ||
    callData.attributes?.patNum;

  if (patNum) {
    const parsed = parseInt(patNum, 10);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Generate a summary note for the call
 */
export function generateCallSummary(analytics: any, patientData?: any): string {
  const lines: string[] = [];
  
  lines.push('=== Call Summary (Automated) ===');
  lines.push(`Call ID: ${analytics.callId}`);
  lines.push(`Date: ${analytics.timestampIso}`);
  lines.push(`Duration: ${formatDuration(analytics.totalDuration)}`);
  lines.push(`Status: ${analytics.status}`);
  
  if (analytics.agentId) {
    lines.push(`Agent: ${analytics.agentId}`);
  }
  
  // Call metrics
  if (analytics.queueDuration > 0) {
    lines.push(`Queue Time: ${formatDuration(analytics.queueDuration)}`);
  }
  if (analytics.talkDuration > 0) {
    lines.push(`Talk Time: ${formatDuration(analytics.talkDuration)}`);
  }
  if (analytics.holdDuration > 0) {
    lines.push(`Hold Time: ${formatDuration(analytics.holdDuration)}`);
  }
  
  // Call characteristics
  const characteristics: string[] = [];
  if (analytics.wasTransferred) characteristics.push('Transferred');
  if (analytics.wasAbandoned) characteristics.push('Abandoned');
  if (analytics.wasCallback) characteristics.push('Callback');
  if (analytics.wasVip) characteristics.push('VIP');
  
  if (characteristics.length > 0) {
    lines.push(`Characteristics: ${characteristics.join(', ')}`);
  }
  
  // Patient information if available
  if (patientData) {
    lines.push('');
    lines.push('=== Patient Information ===');
    lines.push(`Name: ${patientData.FName} ${patientData.LName}`);
    if (patientData.Birthdate && patientData.Birthdate !== '0001-01-01') {
      lines.push(`DOB: ${patientData.Birthdate}`);
    }
    if (patientData.PreferContactMethod && patientData.PreferContactMethod !== 'None') {
      lines.push(`Preferred Contact: ${patientData.PreferContactMethod}`);
    }
  }
  
  lines.push('');
  lines.push('This call summary was automatically generated by the analytics system.');
  
  return lines.join('\n');
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return remainingSeconds > 0 
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}


import clinicsData from "./clinics.json";

// TODO: Implement with zod
export interface Clinic {
  clinicId: string;
  clinicAddress: string;
  clinicCity: string;
  clinicEmail: string;
  clinicFax: string;
  clinicName: string;
  clinicPhone: string;
  clinicState: string;
  logoUrl: string;
  mapsUrl: string;
  scheduleUrl: string;
  websiteLink: string;
  // Open Dental API credentials
  developerKey: string;
  customerKey: string;
  // Phone number for this clinic (inbound/outbound calls)
  phoneNumber: string;
  // Clinic time zone (IANA), e.g., 'America/New_York'
  timeZone?: string;
  // Per-clinic messaging identities
  sesIdentityArn?: string; // e.g., arn:aws:ses:us-east-1:...:identity/example.com
  smsOriginationArn?: string; // e.g., arn:aws:sms-voice:us-east-1:...:phone-number/phone-...
}

// Backend only
export const clinics: Clinic[] = clinicsData;
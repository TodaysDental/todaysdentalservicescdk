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
  CliniczipCode: string;
  logoUrl: string;
  mapsUrl: string;
  scheduleUrl: string;
  websiteLink: string;
  // Open Dental API credentials
  developerKey: string;
  customerKey: string;
  // Phone number for this clinic (inbound/outbound calls)
  phoneNumber: string;
  // Amazon Connect specific properties
  connectPhoneNumberId?: string; // Connect phone number ID
  connectQueueId?: string; // Connect queue ID for this clinic
  connectRoutingProfileId?: string; // Connect routing profile ID
  connectContactFlowId?: string; // Connect contact flow ID
  // Clinic time zone (IANA), e.g., 'America/New_York'
  timeZone?: string;
  // Per-clinic messaging identities
  sesIdentityArn?: string; // e.g., arn:aws:ses:us-east-1:...:identity/example.com
  smsOriginationArn?: string; // e.g., arn:aws:sms-voice:us-east-1:...:phone-number/phone-...
  // SFTP folder path for consolidated Transfer Family setup
  sftpFolderPath: string;
  // Optional: Open Dental ObjectStore name to use as first SftpAddress segment
  odObjectStoreName?: string;
  // Authorize.Net payment processing credentials
  authorizeNetApiLoginId: string;
  authorizeNetTransactionKey: string;
  // RCS Messaging configuration (Twilio)
  rcs?: {
    /** Twilio RCS Sender ID for this clinic */
    rcsSenderId?: string;
    /** Twilio Messaging Service SID (alternative to rcsSenderId) */
    messagingServiceSid?: string;
    /** Whether RCS messaging is enabled for this clinic */
    enabled?: boolean;
  };
}

// Backend only
export const clinics: Clinic[] = clinicsData;
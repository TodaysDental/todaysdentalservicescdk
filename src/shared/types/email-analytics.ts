/**
 * Email Analytics Types
 * 
 * These types support tracking comprehensive email statistics including:
 * - Send events (email accepted by SES)
 * - Delivery events (email delivered to recipient mail server)
 * - Bounce events (hard/soft bounces)
 * - Complaint events (spam reports)
 * - Open events (tracking pixel loaded)
 * - Click events (link clicked)
 * - Reject events (SES rejected the email)
 * - Rendering Failure events (template rendering failed)
 */

// SES Event Types from Configuration Set
export type SESEventType = 
  | 'Send'
  | 'Delivery'
  | 'Bounce'
  | 'Complaint'
  | 'Open'
  | 'Click'
  | 'Reject'
  | 'RenderingFailure'
  | 'DeliveryDelay';

export type BounceType = 'Permanent' | 'Transient' | 'Undetermined';
export type BounceSubType = 
  | 'General'
  | 'NoEmail'
  | 'Suppressed'
  | 'OnAccountSuppressionList'
  | 'MailboxFull'
  | 'MessageTooLarge'
  | 'ContentRejected'
  | 'AttachmentRejected';

export type ComplaintFeedbackType = 
  | 'abuse'
  | 'auth-failure'
  | 'fraud'
  | 'not-spam'
  | 'other'
  | 'virus';

// Email status derived from events
export type EmailStatus = 
  | 'QUEUED'      // Email queued for sending
  | 'SENT'        // SES accepted the email
  | 'DELIVERED'   // Email delivered to recipient's mail server
  | 'OPENED'      // Recipient opened the email
  | 'CLICKED'     // Recipient clicked a link
  | 'BOUNCED'     // Email bounced (permanent or transient)
  | 'COMPLAINED'  // Recipient marked as spam
  | 'REJECTED'    // SES rejected the email
  | 'FAILED';     // Sending failed

// Individual email tracking record
export interface EmailTrackingRecord {
  messageId: string;        // SES Message ID (partition key)
  clinicId: string;         // Clinic identifier
  recipientEmail: string;   // Recipient email address
  patNum?: string;          // Patient number if applicable
  subject?: string;         // Email subject
  templateName?: string;    // Template used
  sentBy?: string;          // User who triggered the send
  sentAt: string;           // ISO timestamp when queued/sent
  
  // Current status (updated as events come in)
  status: EmailStatus;
  lastEventAt?: string;     // Timestamp of last event
  
  // Event timestamps (set when each event occurs)
  sendTimestamp?: string;
  deliveryTimestamp?: string;
  openTimestamp?: string;
  clickTimestamp?: string;
  bounceTimestamp?: string;
  complaintTimestamp?: string;
  
  // Bounce details
  bounceType?: BounceType;
  bounceSubType?: BounceSubType;
  bounceReason?: string;
  
  // Complaint details
  complaintFeedbackType?: ComplaintFeedbackType;
  
  // Click tracking
  clickedLinks?: string[];
  
  // Open tracking
  openCount?: number;
  userAgent?: string;
  
  // TTL for automatic cleanup (optional)
  ttl?: number;
}

// Aggregated analytics for a time period
export interface EmailAnalyticsStats {
  clinicId: string;
  period: string;           // e.g., '2024-01', '2024-01-15', 'all'
  
  // Counts
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalBounced: number;
  totalComplained: number;
  totalFailed: number;
  
  // Bounce breakdown
  hardBounces: number;
  softBounces: number;
  
  // Rates (percentages)
  deliveryRate: number;     // delivered / sent
  openRate: number;         // opened / delivered
  clickRate: number;        // clicked / opened
  bounceRate: number;       // bounced / sent
  complaintRate: number;    // complained / delivered
  
  // Unique counts
  uniqueRecipients: number;
  uniqueOpeners: number;
  uniqueClickers: number;
  
  // Last updated
  lastUpdated: string;
}

// SES Event Notification structures (from SNS)
export interface SESEventNotification {
  eventType: SESEventType;
  mail: SESMailObject;
  send?: SESSendEvent;
  delivery?: SESDeliveryEvent;
  bounce?: SESBounceEvent;
  complaint?: SESComplaintEvent;
  open?: SESOpenEvent;
  click?: SESClickEvent;
  reject?: SESRejectEvent;
  renderingFailure?: SESRenderingFailureEvent;
  deliveryDelay?: SESDeliveryDelayEvent;
}

export interface SESMailObject {
  messageId: string;
  timestamp: string;
  source: string;
  sourceArn?: string;
  sendingAccountId: string;
  destination: string[];
  headersTruncated: boolean;
  headers?: Array<{ name: string; value: string }>;
  commonHeaders?: {
    from?: string[];
    to?: string[];
    subject?: string;
    messageId?: string;
  };
  tags?: Record<string, string[]>;
}

export interface SESSendEvent {
  // Empty for send events
}

export interface SESDeliveryEvent {
  timestamp: string;
  processingTimeMillis: number;
  recipients: string[];
  smtpResponse: string;
  reportingMTA: string;
}

export interface SESBounceEvent {
  bounceType: BounceType;
  bounceSubType: BounceSubType;
  bouncedRecipients: Array<{
    emailAddress: string;
    action?: string;
    status?: string;
    diagnosticCode?: string;
  }>;
  timestamp: string;
  feedbackId: string;
  reportingMTA?: string;
}

export interface SESComplaintEvent {
  complainedRecipients: Array<{
    emailAddress: string;
  }>;
  timestamp: string;
  feedbackId: string;
  complaintSubType?: string;
  complaintFeedbackType?: ComplaintFeedbackType;
  arrivalDate?: string;
}

export interface SESOpenEvent {
  timestamp: string;
  userAgent: string;
  ipAddress: string;
}

export interface SESClickEvent {
  timestamp: string;
  userAgent: string;
  ipAddress: string;
  link: string;
  linkTags?: Record<string, string[]>;
}

export interface SESRejectEvent {
  reason: string;
}

export interface SESRenderingFailureEvent {
  templateName: string;
  errorMessage: string;
}

export interface SESDeliveryDelayEvent {
  delayType: string;
  expirationTime: string;
  delayedRecipients: Array<{
    emailAddress: string;
    status?: string;
    diagnosticCode?: string;
  }>;
  timestamp: string;
}

// API Response types
export interface EmailAnalyticsResponse {
  success: boolean;
  clinicId: string;
  period: string;
  stats: EmailAnalyticsStats;
}

export interface EmailListResponse {
  success: boolean;
  clinicId: string;
  emails: EmailTrackingRecord[];
  total: number;
  nextToken?: string;
}

export interface EmailDetailResponse {
  success: boolean;
  email: EmailTrackingRecord;
  events: EmailEventLog[];
}

export interface EmailEventLog {
  eventType: SESEventType;
  timestamp: string;
  details?: Record<string, any>;
}

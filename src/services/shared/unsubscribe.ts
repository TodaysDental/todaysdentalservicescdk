/**
 * Unsubscribe Utilities
 * 
 * Provides functions for managing communication preferences:
 * - Token generation and verification for secure unsubscribe links
 * - Preference checking before sending notifications
 * - Preference management API helpers
 */

import { createHmac, randomBytes } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Secret key for HMAC token generation - should be set in environment
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || 'todays-dental-unsubscribe-secret-key-2024';

export type CommunicationChannel = 'EMAIL' | 'SMS' | 'RCS' | 'CALL';

export interface UnsubscribePreference {
  pk: string;                    // PREF#<patientId> or EMAIL#<email> or PHONE#<phone>
  sk: string;                    // CLINIC#<clinicId> or GLOBAL
  patientId?: string;
  email?: string;
  phone?: string;
  clinicId: string;              // 'GLOBAL' for all clinics, otherwise specific clinic
  unsubscribedChannels: CommunicationChannel[];
  unsubscribeReason?: string;
  unsubscribedAt: string;
  createdAt: string;
  updatedAt: string;
  unsubscribeToken?: string;     // Token used for unsubscribe (for audit)
}

export interface UnsubscribeTokenPayload {
  patientId?: string;
  email?: string;
  phone?: string;
  clinicId: string;
  channel: CommunicationChannel;
  exp: number;  // Expiration timestamp
}

/**
 * Generate a secure unsubscribe token
 */
export function generateUnsubscribeToken(payload: Omit<UnsubscribeTokenPayload, 'exp'>): string {
  const tokenPayload: UnsubscribeTokenPayload = {
    ...payload,
    exp: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days expiration
  };
  
  const data = JSON.stringify(tokenPayload);
  const base64Data = Buffer.from(data).toString('base64url');
  const signature = createHmac('sha256', UNSUBSCRIBE_SECRET)
    .update(base64Data)
    .digest('base64url');
  
  return `${base64Data}.${signature}`;
}

/**
 * Verify and decode an unsubscribe token
 */
export function verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
  try {
    const [base64Data, signature] = token.split('.');
    if (!base64Data || !signature) return null;
    
    const expectedSignature = createHmac('sha256', UNSUBSCRIBE_SECRET)
      .update(base64Data)
      .digest('base64url');
    
    if (signature !== expectedSignature) {
      console.warn('Invalid unsubscribe token signature');
      return null;
    }
    
    const data = JSON.parse(Buffer.from(base64Data, 'base64url').toString());
    
    // Check expiration
    if (data.exp && data.exp < Date.now()) {
      console.warn('Unsubscribe token expired');
      return null;
    }
    
    return data as UnsubscribeTokenPayload;
  } catch (error) {
    console.error('Error verifying unsubscribe token:', error);
    return null;
  }
}

/**
 * Generate an unsubscribe link for embedding in emails/SMS
 */
export function generateUnsubscribeLink(
  baseUrl: string,
  payload: Omit<UnsubscribeTokenPayload, 'exp'>
): string {
  const token = generateUnsubscribeToken(payload);
  return `${baseUrl}/unsubscribe/${encodeURIComponent(token)}`;
}

/**
 * Generate List-Unsubscribe header value for email
 * Returns both mailto and HTTPS unsubscribe options as per RFC 8058
 */
export function generateListUnsubscribeHeader(
  unsubscribeUrl: string,
  clinicEmail: string
): { listUnsubscribe: string; listUnsubscribePost: string } {
  return {
    listUnsubscribe: `<${unsubscribeUrl}>, <mailto:${clinicEmail}?subject=unsubscribe>`,
    listUnsubscribePost: 'List-Unsubscribe=One-Click',
  };
}

/**
 * Check if a recipient is unsubscribed for a specific channel
 */
export async function isUnsubscribed(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  identifier: { patientId?: string; email?: string; phone?: string },
  clinicId: string,
  channel: CommunicationChannel
): Promise<boolean> {
  try {
    // Build the partition key based on identifier type
    let pk: string;
    if (identifier.patientId) {
      pk = `PREF#${identifier.patientId}`;
    } else if (identifier.email) {
      pk = `EMAIL#${identifier.email.toLowerCase()}`;
    } else if (identifier.phone) {
      pk = `PHONE#${normalizePhone(identifier.phone)}`;
    } else {
      return false; // No identifier provided
    }

    // Check clinic-specific preference first
    const clinicPref = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { pk, sk: `CLINIC#${clinicId}` },
    }));

    if (clinicPref.Item) {
      const pref = clinicPref.Item as UnsubscribePreference;
      if (pref.unsubscribedChannels?.includes(channel)) {
        return true;
      }
    }

    // Check global preference
    const globalPref = await ddb.send(new GetCommand({
      TableName: tableName,
      Key: { pk, sk: 'GLOBAL' },
    }));

    if (globalPref.Item) {
      const pref = globalPref.Item as UnsubscribePreference;
      if (pref.unsubscribedChannels?.includes(channel)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking unsubscribe status:', error);
    // Fail open - if we can't check, allow sending (to not block critical comms)
    return false;
  }
}

/**
 * Record an unsubscribe preference
 */
export async function recordUnsubscribe(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  identifier: { patientId?: string; email?: string; phone?: string },
  clinicId: string,  // 'GLOBAL' for all clinics
  channels: CommunicationChannel[],
  reason?: string,
  token?: string
): Promise<void> {
  // Build the partition key based on identifier type
  let pk: string;
  if (identifier.patientId) {
    pk = `PREF#${identifier.patientId}`;
  } else if (identifier.email) {
    pk = `EMAIL#${identifier.email.toLowerCase()}`;
  } else if (identifier.phone) {
    pk = `PHONE#${normalizePhone(identifier.phone)}`;
  } else {
    throw new Error('At least one identifier (patientId, email, or phone) is required');
  }

  const sk = clinicId === 'GLOBAL' ? 'GLOBAL' : `CLINIC#${clinicId}`;
  const now = new Date().toISOString();

  // Check if record exists
  const existing = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { pk, sk },
  }));

  if (existing.Item) {
    // Update existing record - merge channels
    const existingChannels = (existing.Item as UnsubscribePreference).unsubscribedChannels || [];
    const mergedChannels = [...new Set([...existingChannels, ...channels])];

    await ddb.send(new UpdateCommand({
      TableName: tableName,
      Key: { pk, sk },
      UpdateExpression: 'SET unsubscribedChannels = :channels, updatedAt = :now, unsubscribedAt = :now' +
        (reason ? ', unsubscribeReason = :reason' : '') +
        (token ? ', unsubscribeToken = :token' : ''),
      ExpressionAttributeValues: {
        ':channels': mergedChannels,
        ':now': now,
        ...(reason && { ':reason': reason }),
        ...(token && { ':token': token }),
      },
    }));
  } else {
    // Create new record
    const item: UnsubscribePreference = {
      pk,
      sk,
      clinicId,
      unsubscribedChannels: channels,
      unsubscribedAt: now,
      createdAt: now,
      updatedAt: now,
      ...(identifier.patientId && { patientId: identifier.patientId }),
      ...(identifier.email && { email: identifier.email.toLowerCase() }),
      ...(identifier.phone && { phone: normalizePhone(identifier.phone) }),
      ...(reason && { unsubscribeReason: reason }),
      ...(token && { unsubscribeToken: token }),
    };

    await ddb.send(new PutCommand({
      TableName: tableName,
      Item: item,
    }));
  }
}

/**
 * Resubscribe a recipient to a channel
 */
export async function recordResubscribe(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  identifier: { patientId?: string; email?: string; phone?: string },
  clinicId: string,
  channels: CommunicationChannel[]
): Promise<void> {
  let pk: string;
  if (identifier.patientId) {
    pk = `PREF#${identifier.patientId}`;
  } else if (identifier.email) {
    pk = `EMAIL#${identifier.email.toLowerCase()}`;
  } else if (identifier.phone) {
    pk = `PHONE#${normalizePhone(identifier.phone)}`;
  } else {
    throw new Error('At least one identifier (patientId, email, or phone) is required');
  }

  const sk = clinicId === 'GLOBAL' ? 'GLOBAL' : `CLINIC#${clinicId}`;
  const now = new Date().toISOString();

  // Get existing record
  const existing = await ddb.send(new GetCommand({
    TableName: tableName,
    Key: { pk, sk },
  }));

  if (existing.Item) {
    const existingChannels = (existing.Item as UnsubscribePreference).unsubscribedChannels || [];
    const updatedChannels = existingChannels.filter(ch => !channels.includes(ch));

    if (updatedChannels.length === 0) {
      // No more unsubscribed channels - could delete the record
      // For audit purposes, we'll keep it but with empty channels
      await ddb.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk, sk },
        UpdateExpression: 'SET unsubscribedChannels = :channels, updatedAt = :now',
        ExpressionAttributeValues: {
          ':channels': [],
          ':now': now,
        },
      }));
    } else {
      await ddb.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk, sk },
        UpdateExpression: 'SET unsubscribedChannels = :channels, updatedAt = :now',
        ExpressionAttributeValues: {
          ':channels': updatedChannels,
          ':now': now,
        },
      }));
    }
  }
  // If no record exists, nothing to resubscribe from
}

/**
 * Get all preferences for an identifier
 */
export async function getPreferences(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  identifier: { patientId?: string; email?: string; phone?: string }
): Promise<UnsubscribePreference[]> {
  let pk: string;
  if (identifier.patientId) {
    pk = `PREF#${identifier.patientId}`;
  } else if (identifier.email) {
    pk = `EMAIL#${identifier.email.toLowerCase()}`;
  } else if (identifier.phone) {
    pk = `PHONE#${normalizePhone(identifier.phone)}`;
  } else {
    return [];
  }

  const result = await ddb.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': pk,
    },
  }));

  return (result.Items || []) as UnsubscribePreference[];
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return `+${cleaned}`;
}

/**
 * Generate footer text with unsubscribe link for emails
 */
export function generateEmailUnsubscribeFooter(unsubscribeLink: string, clinicName?: string): string {
  return `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666;">
      <p>
        You received this email because you are a patient of ${clinicName || 'our dental clinic'}. 
        If you no longer wish to receive these emails, you can 
        <a href="${unsubscribeLink}" style="color: #0066cc;">unsubscribe here</a>.
      </p>
    </div>
  `;
}

/**
 * Generate unsubscribe text for SMS messages
 */
export function generateSmsUnsubscribeText(shortUrl?: string): string {
  if (shortUrl) {
    return `\n\nReply STOP to unsubscribe or visit ${shortUrl}`;
  }
  return '\n\nReply STOP to unsubscribe.';
}

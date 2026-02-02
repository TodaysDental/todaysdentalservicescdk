/**
 * FCM HTTP v1 API Client
 * 
 * Sends push notifications to Android devices using the modern Firebase Cloud Messaging
 * HTTP v1 API with OAuth2 authentication via Service Account.
 * 
 * This is the recommended approach by Google as the Legacy API is deprecated.
 * 
 * Prerequisites:
 * - Firebase Cloud Messaging API (V1) enabled in Google Cloud Console
 * - Service Account JSON stored in GlobalSecrets (secretId=fcm, secretType=service_account)
 */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { SignJWT, importPKCS8 } from 'jose';

const dynamodb = new DynamoDB({});
const GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || '';

// Cache for credentials and access token
let cachedServiceAccount: any = null;
let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * FCM v1 API message structure
 */
export interface FcmV1Message {
    token: string;
    notification?: {
        title?: string;
        body?: string;
        image?: string;
    };
    data?: Record<string, string>;
    android?: {
        priority?: 'normal' | 'high';
        ttl?: string;
        notification?: {
            channel_id?: string;
            sound?: string;
            tag?: string;
            click_action?: string;
            icon?: string;
            color?: string;
        };
        data?: Record<string, string>;
    };
}

/**
 * Get service account credentials from GlobalSecrets
 */
async function getServiceAccount(): Promise<any> {
    if (cachedServiceAccount) {
        return cachedServiceAccount;
    }

    try {
        const result = await dynamodb.getItem({
            TableName: GLOBAL_SECRETS_TABLE,
            Key: {
                secretId: { S: 'fcm' },
                secretType: { S: 'service_account' },
            },
        });

        if (!result.Item) {
            console.error('[FCM-v1] Service account not found in GlobalSecrets');
            return null;
        }

        const item = unmarshall(result.Item);
        cachedServiceAccount = JSON.parse(item.value);
        return cachedServiceAccount;
    } catch (error) {
        console.error('[FCM-v1] Error loading service account:', error);
        return null;
    }
}

/**
 * Generate a JWT for OAuth2 authentication
 */
async function generateJwt(serviceAccount: any): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // Import the private key
    const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');

    // Create the JWT
    const jwt = await new SignJWT({
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
    })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + 3600) // 1 hour
        .setIssuer(serviceAccount.client_email)
        .setAudience(serviceAccount.token_uri)
        .setSubject(serviceAccount.client_email)
        .sign(privateKey);

    return jwt;
}

/**
 * Get OAuth2 access token using JWT
 */
async function getAccessToken(): Promise<string | null> {
    const now = Date.now();

    // Return cached token if still valid (with 5 min buffer)
    if (cachedAccessToken && tokenExpiresAt > now + 300000) {
        return cachedAccessToken;
    }

    const serviceAccount = await getServiceAccount();
    if (!serviceAccount) {
        return null;
    }

    try {
        const jwt = await generateJwt(serviceAccount);

        const response = await fetch(serviceAccount.token_uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('[FCM-v1] Failed to get access token:', error);
            return null;
        }

        const data = await response.json() as { access_token: string; expires_in: number };
        cachedAccessToken = data.access_token;
        tokenExpiresAt = now + (data.expires_in * 1000);

        console.log('[FCM-v1] Access token obtained, expires in', data.expires_in, 'seconds');
        return cachedAccessToken;
    } catch (error) {
        console.error('[FCM-v1] Error getting access token:', error);
        return null;
    }
}

/**
 * Send push notification via FCM HTTP v1 API
 */
export async function sendFcmV1Notification(
    deviceToken: string,
    notification: {
        title: string;
        body: string;
        data?: Record<string, any>;
        imageUrl?: string;
        priority?: 'normal' | 'high';
        channelId?: string;
    }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        return { success: false, error: 'Failed to get access token' };
    }

    const serviceAccount = await getServiceAccount();
    if (!serviceAccount) {
        return { success: false, error: 'Service account not configured' };
    }

    // Build the FCM v1 message
    const message: FcmV1Message = {
        token: deviceToken,
        notification: {
            title: notification.title,
            body: notification.body,
        },
        android: {
            priority: notification.priority || 'high',
            notification: {
                channel_id: notification.channelId || 'default',
                sound: 'default',
            },
        },
    };

    // Add image if provided
    if (notification.imageUrl) {
        message.notification!.image = notification.imageUrl;
    }

    // Add data payload if provided
    if (notification.data) {
        // Convert all values to strings as required by FCM
        message.data = {};
        for (const [key, value] of Object.entries(notification.data)) {
            message.data[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
        // Also add to android.data for data-only handling
        message.android!.data = message.data;
    }

    try {
        const url = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        const responseData = await response.json() as { name?: string; error?: { message?: string } };

        if (!response.ok) {
            console.error('[FCM-v1] API error:', responseData);
            return {
                success: false,
                error: responseData.error?.message || `HTTP ${response.status}`,
            };
        }

        console.log('[FCM-v1] Notification sent:', responseData.name);
        return {
            success: true,
            messageId: responseData.name,
        };
    } catch (error: any) {
        console.error('[FCM-v1] Send error:', error);
        return {
            success: false,
            error: error.message,
        };
    }
}

/**
 * Check if FCM v1 API is available (service account configured)
 */
export async function isFcmV1Available(): Promise<boolean> {
    const serviceAccount = await getServiceAccount();
    return !!serviceAccount;
}

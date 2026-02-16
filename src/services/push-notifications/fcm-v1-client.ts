/**
 * FCM HTTP v1 API Client
 * 
 * Sends push notifications to Android and iOS devices using the Firebase Cloud Messaging
 * HTTP v1 API with OAuth2 authentication via Service Account.
 * 
 * This is the PRIMARY and ONLY delivery method for push notifications.
 * SNS Platform Applications have been removed in favor of direct Firebase integration.
 * 
 * Prerequisites:
 * - Firebase Cloud Messaging API (V1) enabled in Google Cloud Console
 * - Service Account JSON stored in GlobalSecrets (secretId=fcm, secretType=service_account)
 * - iOS APNs key configured in Firebase Console for iOS support
 * 
 * Robustness Features:
 * - Rate limiting with exponential backoff for 429 responses
 * - Retry mechanism for transient failures (5xx errors, network issues)
 * - Invalid token detection and cleanup callback
 * - Batched sending with concurrency control
 * - Thread-safe access token caching with lock
 */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { SignJWT, importPKCS8 } from 'jose';

const dynamodb = new DynamoDB({});
const GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || '';

// ========================================
// CONFIGURATION
// ========================================

// Rate limiting configuration
const MAX_CONCURRENT_REQUESTS = 100; // FCM recommended limit per second
const RATE_LIMIT_DELAY_MS = 10; // Delay between batches
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 32000;

// FCM payload size limit (4KB for data messages)
const MAX_PAYLOAD_SIZE_BYTES = 4096;

// Token cache with lock mechanism
let cachedServiceAccount: any = null;
let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;
let tokenRefreshPromise: Promise<string | null> | null = null;

// ========================================
// TYPES
// ========================================

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
    apns?: {
        payload?: {
            aps?: {
                alert?: {
                    title?: string;
                    body?: string;
                };
                badge?: number;
                sound?: string;
                'mutable-content'?: number;
                'content-available'?: number;
                category?: string;
                'thread-id'?: string;
            };
        };
        headers?: Record<string, string>;
    };
    webpush?: {
        notification?: {
            title?: string;
            body?: string;
            icon?: string;
            badge?: string;
            tag?: string;
        };
        fcm_options?: {
            link?: string;
        };
    };
}

/**
 * Result of sending a notification
 */
export interface FcmV1SendResult {
    success: boolean;
    messageId?: string;
    error?: string;
    errorCode?: FcmErrorCode;
    shouldRemoveToken?: boolean;
    retryable?: boolean;
}

/**
 * FCM error codes for proper handling
 */
export type FcmErrorCode =
    | 'INVALID_ARGUMENT'
    | 'UNREGISTERED'
    | 'NOT_FOUND'
    | 'SENDER_ID_MISMATCH'
    | 'QUOTA_EXCEEDED'
    | 'UNAVAILABLE'
    | 'INTERNAL'
    | 'THIRD_PARTY_AUTH_ERROR'
    | 'RATE_LIMIT'
    | 'UNKNOWN';

/**
 * Callback for handling invalid tokens
 */
export type InvalidTokenCallback = (deviceToken: string, reason: string) => Promise<void>;

// Global callback for token cleanup
let invalidTokenCallback: InvalidTokenCallback | null = null;

// ========================================
// TOKEN CLEANUP REGISTRATION
// ========================================

/**
 * Register a callback to be called when invalid tokens are detected
 * This allows the calling code to clean up invalid tokens from the database
 */
export function registerInvalidTokenCallback(callback: InvalidTokenCallback): void {
    invalidTokenCallback = callback;
}

// ========================================
// ACCESS TOKEN MANAGEMENT (Thread-Safe)
// ========================================

/**
 * Escape raw control characters that appear inside JSON string literals.
 *
 * This repairs common copy/paste issues where a JSON string value (most often
 * `private_key`) contains literal newlines or other control characters, which
 * makes `JSON.parse()` throw `Bad control character in string literal`.
 *
 * NOTE: This intentionally ONLY escapes control characters while we are inside
 * a JSON string (between quotes), leaving formatting whitespace (newlines outside
 * strings) untouched.
 */
function escapeControlCharsInJsonStringLiterals(jsonText: string): string {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < jsonText.length; i++) {
        const ch = jsonText[i]!;

        if (inString) {
            if (escaped) {
                out += ch;
                escaped = false;
                continue;
            }

            if (ch === '\\') {
                out += ch;
                escaped = true;
                continue;
            }

            if (ch === '"') {
                out += ch;
                inString = false;
                continue;
            }

            // Escape raw control characters inside string literals
            if (ch === '\n') { out += '\\n'; continue; }
            if (ch === '\r') { out += '\\r'; continue; }
            if (ch === '\t') { out += '\\t'; continue; }

            const code = ch.charCodeAt(0);
            if (code < 0x20) {
                out += `\\u${code.toString(16).padStart(4, '0')}`;
                continue;
            }

            out += ch;
            continue;
        }

        // Not in a string
        if (ch === '"') {
            out += ch;
            inString = true;
            continue;
        }

        out += ch;
    }

    return out;
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
        const rawValue = typeof (item as any).value === 'string' ? (item as any).value : '';

        try {
            cachedServiceAccount = JSON.parse(rawValue);
        } catch (error: any) {
            // Attempt repair for common control-character issues (e.g., literal newlines in private_key)
            try {
                const repaired = escapeControlCharsInJsonStringLiterals(rawValue);
                cachedServiceAccount = JSON.parse(repaired);
                console.warn('[FCM-v1] Repaired invalid service account JSON (escaped control characters in string literals)');
            } catch (repairError: any) {
                console.error('[FCM-v1] Service account JSON is invalid. Ensure GlobalSecrets fcm/service_account is valid JSON and private_key newlines are escaped as \\\\n');
                console.error('[FCM-v1] Original parse error:', error?.message || String(error));
                return null;
            }
        }

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
 * Get OAuth2 access token using JWT (thread-safe with lock)
 * Uses a promise-based lock to prevent concurrent token refreshes
 * Includes retry logic with exponential backoff for transient failures
 */
async function getAccessToken(): Promise<string | null> {
    const now = Date.now();
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    // Return cached token if still valid (with 5 min buffer)
    if (cachedAccessToken && tokenExpiresAt > now + 300000) {
        return cachedAccessToken;
    }

    // If another request is already refreshing, wait for it
    if (tokenRefreshPromise) {
        return tokenRefreshPromise;
    }

    // Start refresh and store the promise
    tokenRefreshPromise = (async () => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const serviceAccount = await getServiceAccount();
                if (!serviceAccount) {
                    console.error('[FCM-v1] Service account not available');
                    return null;
                }

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
                    console.error(`[FCM-v1] Failed to get access token (attempt ${attempt + 1}/${MAX_RETRIES}):`, error);

                    // Check if error is retryable (5xx or network issues)
                    if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
                        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
                        console.log(`[FCM-v1] Retrying token refresh in ${Math.round(delay)}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    return null;
                }

                const data = await response.json() as { access_token: string; expires_in: number };
                cachedAccessToken = data.access_token;
                tokenExpiresAt = Date.now() + (data.expires_in * 1000);

                console.log('[FCM-v1] Access token obtained, expires in', data.expires_in, 'seconds');
                return cachedAccessToken;
            } catch (error) {
                console.error(`[FCM-v1] Error getting access token (attempt ${attempt + 1}/${MAX_RETRIES}):`, error);

                // Retry on transient errors
                if (attempt < MAX_RETRIES - 1) {
                    const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
                    console.log(`[FCM-v1] Retrying token refresh in ${Math.round(delay)}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                return null;
            }
        }
        return null;
    })().finally(() => {
        // Clear the promise after completion (success or failure)
        tokenRefreshPromise = null;
    });

    return tokenRefreshPromise;
}

// ========================================
// PAYLOAD VALIDATION
// ========================================

/**
 * Calculate the size of a JSON payload in bytes
 */
function calculatePayloadSize(payload: any): number {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
}

/**
 * Validate and potentially truncate notification payload to fit FCM limits
 */
function validateAndPreparePayload(
    notification: {
        title: string;
        body: string;
        data?: Record<string, any>;
        imageUrl?: string;
        priority?: 'normal' | 'high';
        channelId?: string;
        badge?: number;
        sound?: string;
        category?: string;
        threadId?: string;
    },
    platform: 'android' | 'ios' | 'web'
): { valid: boolean; error?: string; data?: Record<string, string> } {
    // Convert all data values to strings as required by FCM
    const stringData: Record<string, string> = {};
    if (notification.data) {
        for (const [key, value] of Object.entries(notification.data)) {
            if (value === null || value === undefined) continue;
            stringData[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
    }

    // Check payload size
    const payloadSize = calculatePayloadSize(stringData);
    if (payloadSize > MAX_PAYLOAD_SIZE_BYTES) {
        console.warn(`[FCM-v1] Payload size ${payloadSize} exceeds limit of ${MAX_PAYLOAD_SIZE_BYTES} bytes`);
        return {
            valid: false,
            error: `Payload size (${payloadSize} bytes) exceeds FCM limit of ${MAX_PAYLOAD_SIZE_BYTES} bytes`,
        };
    }

    return { valid: true, data: stringData };
}

// ========================================
// ERROR HANDLING
// ========================================

/**
 * Parse FCM error response and determine appropriate action
 */
function parseFcmError(
    statusCode: number,
    responseData: { error?: { message?: string; code?: number; status?: string; details?: any[] } }
): { errorCode: FcmErrorCode; message: string; shouldRemoveToken: boolean; retryable: boolean } {
    const errorMessage = responseData.error?.message || `HTTP ${statusCode}`;
    const errorStatus = responseData.error?.status || '';

    // Rate limit error
    if (statusCode === 429) {
        return {
            errorCode: 'RATE_LIMIT',
            message: 'Rate limit exceeded',
            shouldRemoveToken: false,
            retryable: true,
        };
    }

    // Invalid/unregistered token errors - should remove token
    if (statusCode === 404 || errorStatus === 'NOT_FOUND') {
        return {
            errorCode: 'NOT_FOUND',
            message: 'Device token not found or invalid',
            shouldRemoveToken: true,
            retryable: false,
        };
    }

    if (errorStatus === 'UNREGISTERED' || errorMessage.toLowerCase().includes('unregistered')) {
        return {
            errorCode: 'UNREGISTERED',
            message: 'Device token is unregistered',
            shouldRemoveToken: true,
            retryable: false,
        };
    }

    if (errorStatus === 'INVALID_ARGUMENT') {
        // Check if it's specifically about the token
        if (errorMessage.toLowerCase().includes('token') ||
            errorMessage.toLowerCase().includes('registration')) {
            return {
                errorCode: 'INVALID_ARGUMENT',
                message: errorMessage,
                shouldRemoveToken: true,
                retryable: false,
            };
        }
        return {
            errorCode: 'INVALID_ARGUMENT',
            message: errorMessage,
            shouldRemoveToken: false,
            retryable: false,
        };
    }

    if (errorStatus === 'SENDER_ID_MISMATCH') {
        return {
            errorCode: 'SENDER_ID_MISMATCH',
            message: 'Sender ID mismatch - token registered to different project',
            shouldRemoveToken: true,
            retryable: false,
        };
    }

    // THIRD_PARTY_AUTH_ERROR - Firebase cannot authenticate with APNs.
    // This is almost always a Firebase Console configuration issue (missing/expired
    // APNs auth key), NOT a problem with the individual device token. Deleting the
    // token would force users to re-register even after the APNs key is fixed, so
    // we keep the token and treat it as non-retryable for the current attempt only.
    const fcmErrorCode = responseData.error?.details?.find(
        (d: any) => d['@type']?.includes('FcmError')
    )?.errorCode;

    if (fcmErrorCode === 'THIRD_PARTY_AUTH_ERROR' || errorStatus === 'UNAUTHENTICATED') {
        console.warn('[FCM-v1] APNs authentication failed — check that the APNs key (.p8) is uploaded and valid in Firebase Console > Project Settings > Cloud Messaging');
        return {
            errorCode: 'THIRD_PARTY_AUTH_ERROR',
            message: 'APNs authentication failed - check Firebase Console APNs key configuration',
            shouldRemoveToken: false,
            retryable: false,
        };
    }

    // Server errors - retryable
    if (statusCode >= 500 || errorStatus === 'UNAVAILABLE' || errorStatus === 'INTERNAL') {
        return {
            errorCode: statusCode >= 500 ? 'UNAVAILABLE' : (errorStatus as FcmErrorCode) || 'UNAVAILABLE',
            message: errorMessage,
            shouldRemoveToken: false,
            retryable: true,
        };
    }

    // Quota exceeded
    if (errorStatus === 'QUOTA_EXCEEDED') {
        return {
            errorCode: 'QUOTA_EXCEEDED',
            message: 'FCM quota exceeded',
            shouldRemoveToken: false,
            retryable: true, // Can retry after backoff
        };
    }

    // Unknown error
    return {
        errorCode: 'UNKNOWN',
        message: errorMessage,
        shouldRemoveToken: false,
        retryable: false,
    };
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number, baseDelay: number = INITIAL_RETRY_DELAY_MS): number {
    const delay = baseDelay * Math.pow(2, attempt);
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.min(delay + jitter, MAX_RETRY_DELAY_MS);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// SEND NOTIFICATION (Single)
// ========================================

/**
 * Send push notification via FCM HTTP v1 API
 * 
 * Supports Android, iOS, and Web devices.
 * - Android: Uses FCM directly
 * - iOS: Routes through Firebase to APNs using the configured APNs key
 * - Web: Uses FCM with web push (VAPID key configured in Firebase Console)
 * 
 * Features:
 * - Automatic retry with exponential backoff for transient failures
 * - Rate limit handling with backoff
 * - Invalid token detection with cleanup callback
 * - Payload size validation
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
        badge?: number;
        sound?: string;
        category?: string;
        threadId?: string;
        dataOnly?: boolean; // When true, send data-only message (no FCM notification payload)
    },
    platform: 'android' | 'ios' | 'web' = 'android'
): Promise<FcmV1SendResult> {
    // Validate device token
    if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.trim() === '') {
        return {
            success: false,
            error: 'Invalid device token: empty or null',
            errorCode: 'INVALID_ARGUMENT',
            shouldRemoveToken: true,
            retryable: false,
        };
    }

    // Validate and prepare payload
    const payloadValidation = validateAndPreparePayload(notification, platform);
    if (!payloadValidation.valid) {
        return {
            success: false,
            error: payloadValidation.error,
            errorCode: 'INVALID_ARGUMENT',
            shouldRemoveToken: false,
            retryable: false,
        };
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
        return {
            success: false,
            error: 'Failed to get access token',
            retryable: true, // Could be transient
        };
    }

    const serviceAccount = await getServiceAccount();
    if (!serviceAccount) {
        return { success: false, error: 'Service account not configured' };
    }

    // Determine if this should be a data-only message.
    // Data-only messages bypass Android's system notification handler and ALWAYS
    // trigger onMessageReceived() in TDIFirebaseMessagingService, even when the
    // app is in background. This is critical for incoming_call notifications
    // that need custom ringtone, vibration, and wake-lock behavior.
    const isDataOnly = notification.dataOnly === true;

    // Build the FCM v1 message with platform-specific configuration
    const message: FcmV1Message = {
        token: deviceToken.trim(),
    };

    // Only include top-level `notification` for display notifications (not data-only)
    // EXCEPTION: Web platform ALWAYS needs the top-level notification field, because
    // Firebase Web SDK's onMessage() only fires for foreground messages when
    // `message.notification` is present. Without it, data-only pushes go straight
    // to the service worker's push event and never reach onMessage().
    if (!isDataOnly || platform === 'web') {
        message.notification = {
            title: notification.title,
            body: notification.body,
        };

        // Add image if provided
        if (notification.imageUrl) {
            message.notification.image = notification.imageUrl;
        }
    }

    // Add data payload
    if (payloadValidation.data && Object.keys(payloadValidation.data).length > 0) {
        message.data = payloadValidation.data;
    }

    // For data-only messages, ensure title and body are in the data payload
    // so the app can construct the notification itself
    if (isDataOnly && message.data) {
        if (!message.data.title) message.data.title = notification.title;
        if (!message.data.body) message.data.body = notification.body;
    }

    // Platform-specific configuration
    if (platform === 'android') {
        if (isDataOnly) {
            // Data-only Android message: high priority to wake the device,
            // but NO android.notification block — ensures onMessageReceived() fires
            message.android = {
                priority: 'high',
                ttl: '0s', // Deliver immediately, don't store-and-forward
            };
        } else {
            // Display notification: includes android.notification for system tray
            message.android = {
                priority: notification.priority || 'high',
                notification: {
                    channel_id: notification.channelId || 'default',
                    sound: notification.sound || 'default',
                },
            };
        }
        if (message.data) {
            message.android.data = message.data;
        }
    } else if (platform === 'ios') {
        const dataType = typeof message.data?.type === 'string' ? message.data.type : '';
        const silentDataOnlyTypes = new Set(['call_ended', 'call_cancelled', 'call_answered', 'sync_unread']);
        const shouldUseSilentApns = isDataOnly && silentDataOnlyTypes.has(dataType);

        if (shouldUseSilentApns) {
            // Silent background push (no alert/sound). Used for call state transitions that should NOT
            // generate user-visible notifications but must still reach the app to clear UI state.
            message.apns = {
                headers: {
                    'apns-priority': '5',
                    'apns-push-type': 'background',
                },
                payload: {
                    aps: {
                        'content-available': 1,
                    },
                },
            };
        } else if (isDataOnly) {
            // High-priority alert push (no top-level FCM notification) — ensures Android handlers fire
            // while still presenting an alert on iOS (e.g., incoming_call).
            message.apns = {
                headers: {
                    'apns-priority': '10',
                    'apns-push-type': 'alert',
                },
                payload: {
                    aps: {
                        alert: {
                            title: notification.title,
                            body: notification.body,
                        },
                        badge: notification.badge ?? 1,
                        sound: notification.sound || 'default',
                        'content-available': 1,
                    },
                },
            };
        } else {
            message.apns = {
                headers: {
                    'apns-priority': notification.priority === 'high' ? '10' : '5',
                    'apns-push-type': 'alert',
                },
                payload: {
                    aps: {
                        alert: {
                            title: notification.title,
                            body: notification.body,
                        },
                        badge: notification.badge ?? 1,
                        sound: notification.sound || 'default',
                        'mutable-content': notification.imageUrl ? 1 : 0,
                        'content-available': 1,
                    },
                },
            };
        }

        if (!shouldUseSilentApns && notification.category) {
            message.apns!.payload!.aps!.category = notification.category;
        }
        if (!shouldUseSilentApns && notification.threadId) {
            message.apns!.payload!.aps!['thread-id'] = notification.threadId;
        }
    } else if (platform === 'web') {
        // Web push configuration — always include notification for browser display
        message.webpush = {
            notification: {
                title: notification.title,
                body: notification.body,
            },
        };
    }

    // Send with retry logic
    let lastError: string = '';
    let lastErrorCode: FcmErrorCode | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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

            const responseData = await response.json() as { name?: string; error?: { message?: string; code?: number; status?: string; details?: any[] } };

            if (response.ok) {
                console.log('[FCM-v1] Notification sent:', responseData.name);
                return {
                    success: true,
                    messageId: responseData.name,
                };
            }

            // Parse error
            const errorInfo = parseFcmError(response.status, responseData);
            console.error(`[FCM-v1] API error (attempt ${attempt + 1}):`, JSON.stringify(responseData));

            lastError = errorInfo.message;
            lastErrorCode = errorInfo.errorCode;

            // Handle invalid token - clean up and don't retry
            if (errorInfo.shouldRemoveToken) {
                // Call cleanup callback if registered
                if (invalidTokenCallback) {
                    try {
                        await invalidTokenCallback(deviceToken, errorInfo.message);
                        console.log(`[FCM-v1] Invalid token cleanup triggered for: ${deviceToken.substring(0, 20)}...`);
                    } catch (callbackError) {
                        console.error('[FCM-v1] Error in invalid token callback:', callbackError);
                    }
                }

                return {
                    success: false,
                    error: errorInfo.message,
                    errorCode: errorInfo.errorCode,
                    shouldRemoveToken: true,
                    retryable: false,
                };
            }

            // Handle retryable errors
            if (errorInfo.retryable && attempt < MAX_RETRIES) {
                const backoffMs = calculateBackoff(attempt);
                console.log(`[FCM-v1] Retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                await sleep(backoffMs);
                continue;
            }

            // Non-retryable error
            return {
                success: false,
                error: errorInfo.message,
                errorCode: errorInfo.errorCode,
                shouldRemoveToken: errorInfo.shouldRemoveToken,
                retryable: errorInfo.retryable,
            };

        } catch (error: any) {
            // Network error or other exception
            lastError = error.message || 'Network error';
            console.error(`[FCM-v1] Send error (attempt ${attempt + 1}):`, error);

            if (attempt < MAX_RETRIES) {
                const backoffMs = calculateBackoff(attempt);
                console.log(`[FCM-v1] Retrying after network error in ${backoffMs}ms`);
                await sleep(backoffMs);
                continue;
            }
        }
    }

    // All retries exhausted
    return {
        success: false,
        error: lastError || 'Max retries exceeded',
        errorCode: lastErrorCode,
        retryable: true, // Caller may want to try again later
    };
}

// ========================================
// SEND NOTIFICATION BATCH
// ========================================

/**
 * Send push notification to multiple devices in batch
 * FCM v1 API requires individual requests per token, so we send them with:
 * - Concurrency control to avoid overwhelming FCM
 * - Rate limiting between batches
 * - Proper result mapping back to input devices
 */
export async function sendFcmV1NotificationBatch(
    devices: Array<{
        deviceToken: string;
        platform: 'android' | 'ios' | 'web';
    }>,
    notification: {
        title: string;
        body: string;
        data?: Record<string, any>;
        imageUrl?: string;
        priority?: 'normal' | 'high';
        channelId?: string;
        badge?: number;
        sound?: string;
        category?: string;
        threadId?: string;
        dataOnly?: boolean; // When true, send data-only message (no FCM notification payload)
    }
): Promise<{ sent: number; failed: number; results: Array<{ deviceToken: string; success: boolean; messageId?: string; error?: string; shouldRemoveToken?: boolean }> }> {
    // Filter out invalid devices
    const validDevices = devices.filter(d => d.deviceToken && typeof d.deviceToken === 'string' && d.deviceToken.trim() !== '');
    const invalidDevices = devices.filter(d => !d.deviceToken || typeof d.deviceToken !== 'string' || d.deviceToken.trim() === '');

    if (validDevices.length === 0) {
        return {
            sent: 0,
            failed: devices.length,
            results: devices.map(d => ({
                deviceToken: d.deviceToken || '',
                success: false,
                error: 'Invalid device token: empty or null',
                shouldRemoveToken: true,
            })),
        };
    }

    // Check if FCM is available before starting
    if (!await isFcmV1Available()) {
        return {
            sent: 0,
            failed: devices.length,
            results: devices.map(d => ({
                deviceToken: d.deviceToken,
                success: false,
                error: 'FCM service account not configured',
            })),
        };
    }

    // Process in batches with concurrency control
    const results: Array<{ deviceToken: string; success: boolean; messageId?: string; error?: string; shouldRemoveToken?: boolean }> = [];

    // Add results for invalid devices first
    for (const device of invalidDevices) {
        results.push({
            deviceToken: device.deviceToken || '',
            success: false,
            error: 'Invalid device token: empty or null',
            shouldRemoveToken: true,
        });
    }

    // Process valid devices in batches
    for (let i = 0; i < validDevices.length; i += MAX_CONCURRENT_REQUESTS) {
        const batch = validDevices.slice(i, i + MAX_CONCURRENT_REQUESTS);

        // Send batch in parallel
        const batchPromises = batch.map(async (device) => {
            const result = await sendFcmV1Notification(
                device.deviceToken,
                notification,
                device.platform
            );
            return {
                deviceToken: device.deviceToken,
                success: result.success,
                messageId: result.messageId,
                error: result.error,
                shouldRemoveToken: result.shouldRemoveToken,
            };
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Rate limit delay between batches (only if more batches to process)
        if (i + MAX_CONCURRENT_REQUESTS < validDevices.length) {
            await sleep(RATE_LIMIT_DELAY_MS);
        }
    }

    // Create a map to preserve original order
    const resultMap = new Map(results.map(r => [r.deviceToken, r]));
    const orderedResults = devices.map(d =>
        resultMap.get(d.deviceToken) || {
            deviceToken: d.deviceToken || '',
            success: false,
            error: 'Result not found',
        }
    );

    const sent = orderedResults.filter(r => r.success).length;
    const failed = orderedResults.filter(r => !r.success).length;

    console.log(`[FCM-v1] Batch send complete: ${sent} sent, ${failed} failed`);

    // Return results in same order as input
    return { sent, failed, results: orderedResults };
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Check if FCM v1 API is available (service account configured)
 */
export async function isFcmV1Available(): Promise<boolean> {
    const serviceAccount = await getServiceAccount();
    return !!serviceAccount;
}

/**
 * Clear cached credentials (useful for testing or when credentials are rotated)
 */
export function clearFcmCache(): void {
    cachedServiceAccount = null;
    cachedAccessToken = null;
    tokenExpiresAt = 0;
    tokenRefreshPromise = null;
}

/**
 * Get current cache status (for debugging/monitoring)
 */
export function getFcmCacheStatus(): { hasServiceAccount: boolean; hasAccessToken: boolean; tokenExpiresIn: number } {
    return {
        hasServiceAccount: !!cachedServiceAccount,
        hasAccessToken: !!cachedAccessToken,
        tokenExpiresIn: Math.max(0, tokenExpiresAt - Date.now()),
    };
}

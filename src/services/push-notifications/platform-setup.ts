/**
 * Push Platform Setup Lambda
 * 
 * Custom Resource handler that creates/updates SNS Platform Applications
 * using credentials stored in GlobalSecrets DynamoDB table.
 * 
 * This runs at CDK deployment time and:
 * 1. Reads FCM and APNs credentials from GlobalSecrets table
 * 2. Creates or updates SNS Platform Applications
 * 3. Returns the Platform ARNs for use by other resources
 */

import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { SNS } from '@aws-sdk/client-sns';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamodb = new DynamoDB({});
const sns = new SNS({});

// Environment variables
const GLOBAL_SECRETS_TABLE = process.env.GLOBAL_SECRETS_TABLE || '';
const STACK_NAME = process.env.STACK_NAME || 'PushNotifications';
const ENABLE_APNS_SANDBOX = process.env.ENABLE_APNS_SANDBOX === 'true';

interface CloudFormationEvent {
    RequestType: 'Create' | 'Update' | 'Delete';
    ResponseURL: string;
    StackId: string;
    RequestId: string;
    ResourceType: string;
    LogicalResourceId: string;
    PhysicalResourceId?: string;
    ResourceProperties: Record<string, any>;
    OldResourceProperties?: Record<string, any>;
}

interface PlatformAppResult {
    fcmPlatformArn?: string;
    apnsPlatformArn?: string;
    apnsSandboxPlatformArn?: string;
}

/**
 * Get a secret from GlobalSecrets DynamoDB table
 */
async function getGlobalSecret(secretId: string, secretType: string): Promise<string | null> {
    try {
        const result = await dynamodb.getItem({
            TableName: GLOBAL_SECRETS_TABLE,
            Key: {
                secretId: { S: secretId },
                secretType: { S: secretType },
            },
        });

        if (!result.Item) {
            console.log(`[PushSetup] Secret not found: ${secretId}/${secretType}`);
            return null;
        }

        const item = unmarshall(result.Item);
        return item.value || null;
    } catch (error) {
        console.error(`[PushSetup] Error reading secret ${secretId}/${secretType}:`, error);
        return null;
    }
}

/**
 * Create or update an SNS Platform Application
 */
async function createOrUpdatePlatformApp(
    name: string,
    platform: 'GCM' | 'APNS' | 'APNS_SANDBOX',
    attributes: Record<string, string>
): Promise<string | null> {
    try {
        // Try to find existing platform application
        let existingArn: string | null = null;
        let nextToken: string | undefined;

        do {
            const listResult = await sns.listPlatformApplications({ NextToken: nextToken });
            const apps = listResult.PlatformApplications || [];

            for (const app of apps) {
                if (app.PlatformApplicationArn?.includes(name)) {
                    existingArn = app.PlatformApplicationArn;
                    break;
                }
            }

            nextToken = listResult.NextToken;
        } while (nextToken && !existingArn);

        if (existingArn) {
            // Update existing platform application
            console.log(`[PushSetup] Updating existing platform app: ${name}`);
            await sns.setPlatformApplicationAttributes({
                PlatformApplicationArn: existingArn,
                Attributes: attributes,
            });
            return existingArn;
        } else {
            // Create new platform application
            console.log(`[PushSetup] Creating new platform app: ${name}`);
            const result = await sns.createPlatformApplication({
                Name: name,
                Platform: platform,
                Attributes: attributes,
            });
            return result.PlatformApplicationArn || null;
        }
    } catch (error) {
        console.error(`[PushSetup] Error with platform app ${name}:`, error);
        return null;
    }
}

/**
 * Delete an SNS Platform Application
 */
async function deletePlatformApp(arn: string): Promise<void> {
    try {
        console.log(`[PushSetup] Deleting platform app: ${arn}`);
        await sns.deletePlatformApplication({ PlatformApplicationArn: arn });
    } catch (error) {
        console.error(`[PushSetup] Error deleting platform app ${arn}:`, error);
    }
}

/**
 * Setup FCM Platform Application (Android)
 * 
 * FCM supports two credential types for AWS SNS:
 * 1. Token Credentials (Recommended) - Firebase Service Account JSON
 *    - GlobalSecrets: secretId=fcm, secretType=service_account
 *    - Contains the full service account JSON from Firebase Console
 * 2. Key Credentials (Legacy, deprecated by Google)
 *    - GlobalSecrets: secretId=fcm, secretType=server_key
 *    - Legacy server key from Firebase Console
 * 
 * AWS SNS supports both, but Token Credentials is recommended as Google
 * is deprecating the legacy Cloud Messaging API.
 */
async function setupFCM(): Promise<string | null> {
    // First try Token Credentials (Service Account JSON) - Recommended
    const serviceAccountJson = await getGlobalSecret('fcm', 'service_account');

    if (serviceAccountJson) {
        console.log('[PushSetup] Found FCM service_account, creating SNS Platform Application with token credentials');
        try {
            // The service account JSON might have actual newlines in the private_key field
            // that should be \n escape sequences. This can happen due to double-processing during storage.
            // We need to convert actual newlines back to \n escape sequences within string values.
            // A simple approach: replace actual newlines with \n (escaped)
            const cleanedJson = serviceAccountJson
                .replace(/\r\n/g, '\\n')  // Windows newlines
                .replace(/\n/g, '\\n');    // Unix newlines

            // Validate it's valid JSON
            const parsed = JSON.parse(cleanedJson);
            console.log('[PushSetup] FCM service_account JSON validated, project_id:', parsed.project_id);
            console.log('[PushSetup] FCM service_account client_email:', parsed.client_email);
            console.log('[PushSetup] FCM private_key starts with:', parsed.private_key?.substring(0, 50));
            console.log('[PushSetup] FCM private_key length:', parsed.private_key?.length);

            // Re-stringify the parsed JSON to ensure proper formatting for AWS SNS
            // AWS SNS expects a properly formatted JSON string with escaped newlines
            const formattedJson = JSON.stringify(parsed);
            console.log('[PushSetup] Sending formatted JSON (length:', formattedJson.length, ')');

            return createOrUpdatePlatformApp(
                `${STACK_NAME}-FCM`,
                'GCM',
                {
                    PlatformCredential: formattedJson,
                }
            );
        } catch (parseError) {
            console.error('[PushSetup] Invalid FCM service_account JSON:', parseError);
        }
    }

    // Fallback to Legacy Server Key (deprecated by Google but still works)
    const serverKey = await getGlobalSecret('fcm', 'server_key');

    if (serverKey) {
        console.log('[PushSetup] Found FCM server_key (legacy), creating SNS Platform Application');
        console.log('[PushSetup] Note: Legacy server key is deprecated. Consider migrating to service_account');
        return createOrUpdatePlatformApp(
            `${STACK_NAME}-FCM`,
            'GCM',
            { PlatformCredential: serverKey }
        );
    }

    console.log('[PushSetup] FCM credentials not found in GlobalSecrets');
    console.log('[PushSetup] To enable FCM push notifications, add one of:');
    console.log('[PushSetup]   - fcm/service_account (recommended): Firebase service account JSON');
    console.log('[PushSetup]   - fcm/server_key (legacy): Firebase Cloud Messaging server key');
    return null;
}



/**
 * Setup APNs Platform Applications (iOS)
 */
async function setupAPNS(): Promise<{ production?: string; sandbox?: string }> {
    // APNs uses token-based authentication
    // Credentials should be stored in GlobalSecrets as:
    // - secretId=apns, secretType=signing_key (the .p8 private key content)
    // - secretId=apns, secretType=key_id
    // - secretId=apns, secretType=team_id
    // - secretId=apns, secretType=bundle_id

    const [signingKey, keyId, teamId, bundleId] = await Promise.all([
        getGlobalSecret('apns', 'signing_key'),
        getGlobalSecret('apns', 'key_id'),
        getGlobalSecret('apns', 'team_id'),
        getGlobalSecret('apns', 'bundle_id'),
    ]);

    if (!signingKey || !keyId || !teamId || !bundleId) {
        console.log('[PushSetup] APNs credentials incomplete in GlobalSecrets, skipping APNs setup');
        console.log(`[PushSetup] Found: signingKey=${!!signingKey}, keyId=${!!keyId}, teamId=${!!teamId}, bundleId=${!!bundleId}`);
        return {};
    }

    const apnsAttributes = {
        PlatformCredential: signingKey,
        PlatformPrincipal: keyId,
        TeamId: teamId,
        BundleId: bundleId,
    };

    const result: { production?: string; sandbox?: string } = {};

    // Production APNs
    result.production = await createOrUpdatePlatformApp(
        `${STACK_NAME}-APNS`,
        'APNS',
        apnsAttributes
    ) || undefined;

    // Sandbox APNs (for development)
    if (ENABLE_APNS_SANDBOX) {
        result.sandbox = await createOrUpdatePlatformApp(
            `${STACK_NAME}-APNS-Sandbox`,
            'APNS_SANDBOX',
            apnsAttributes
        ) || undefined;
    }

    return result;
}

/**
 * Send CloudFormation response
 */
async function sendResponse(
    event: CloudFormationEvent,
    status: 'SUCCESS' | 'FAILED',
    physicalResourceId: string,
    data: Record<string, any> = {},
    reason?: string
): Promise<void> {
    const responseBody = JSON.stringify({
        Status: status,
        Reason: reason || `See CloudWatch Log Stream: ${process.env.AWS_LAMBDA_LOG_STREAM_NAME}`,
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: data,
    });

    console.log(`[PushSetup] Sending response to ${event.ResponseURL}`);
    console.log(`[PushSetup] Response body: ${responseBody}`);

    const response = await fetch(event.ResponseURL, {
        method: 'PUT',
        headers: {
            'Content-Type': '',
            'Content-Length': String(responseBody.length),
        },
        body: responseBody,
    });

    console.log(`[PushSetup] Response status: ${response.status}`);
}

/**
 * Main handler for CDK Custom Resource Provider framework
 * 
 * When using cr.Provider, the framework wraps this Lambda and:
 * 1. Intercepts the CloudFormation event
 * 2. Calls our handler with a modified event
 * 3. Expects us to RETURN the response (not send it via HTTP)
 * 4. Sends the CloudFormation response on our behalf
 * 
 * The expected return format is:
 * {
 *   PhysicalResourceId: string,
 *   Data: { key: value, ... }  // These become custom resource attributes
 * }
 */
export const handler = async (event: CloudFormationEvent): Promise<{
    PhysicalResourceId: string;
    Data: Record<string, string>;
}> => {
    console.log('[PushSetup] Event:', JSON.stringify(event, null, 2));

    const physicalResourceId = event.PhysicalResourceId || `push-platform-setup-${Date.now()}`;

    // IMPORTANT: Always return all expected attributes, even when empty.
    // CloudFormation's CustomResource.getAttString() will fail if an attribute
    // is not present in the response.
    const emptyData = {
        FcmPlatformArn: '',
        ApnsPlatformArn: '',
        ApnsSandboxPlatformArn: '',
    };

    try {
        if (event.RequestType === 'Delete') {
            // On delete, we could clean up platform apps, but they're usually retained
            // for continuity. Return empty data for all expected attributes.
            console.log('[PushSetup] Delete request - platform apps will be retained');
            return {
                PhysicalResourceId: physicalResourceId,
                Data: emptyData,
            };
        }

        // Create or Update
        console.log(`[PushSetup] ${event.RequestType} request - setting up platform apps`);

        const fcmArn = await setupFCM();
        const apnsResult = await setupAPNS();

        const data = {
            FcmPlatformArn: fcmArn || '',
            ApnsPlatformArn: apnsResult.production || '',
            ApnsSandboxPlatformArn: apnsResult.sandbox || '',
        };

        console.log('[PushSetup] Setup complete:', data);

        return {
            PhysicalResourceId: physicalResourceId,
            Data: data,
        };
    } catch (error: any) {
        console.error('[PushSetup] Error:', error);
        // For CR Provider, throwing an error will cause the framework to send a FAILED response
        throw error;
    }
};

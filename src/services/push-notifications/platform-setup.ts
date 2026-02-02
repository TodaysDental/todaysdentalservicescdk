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
 * FCM supports two credential types:
 * 1. Legacy Server Key (for SNS Platform Applications)
 *    - GlobalSecrets: secretId=fcm, secretType=server_key
 * 2. Service Account JSON (for FCM HTTP v1 API - stored for reference)
 *    - GlobalSecrets: secretId=fcm, secretType=service_account
 *    - This is NOT used for SNS, but the send-push Lambda can use it for direct API calls
 */
async function setupFCM(): Promise<string | null> {
    // First try Legacy Server Key (required for SNS Platform Applications)
    const serverKey = await getGlobalSecret('fcm', 'server_key');

    if (serverKey) {
        console.log('[PushSetup] Found FCM server_key, creating SNS Platform Application');
        return createOrUpdatePlatformApp(
            `${STACK_NAME}-FCM`,
            'GCM',
            { PlatformCredential: serverKey }
        );
    }

    // Check if service_account exists (for informational purposes)
    const serviceAccount = await getGlobalSecret('fcm', 'service_account');
    if (serviceAccount) {
        console.log('[PushSetup] Found FCM service_account (for HTTP v1 API), but SNS requires server_key');
        console.log('[PushSetup] To enable SNS Platform Application, add fcm/server_key to GlobalSecrets');
        console.log('[PushSetup] Get Legacy Server Key from Firebase Console → Project Settings → Cloud Messaging');
        // The send-push Lambda can still use service_account for direct FCM v1 API calls
        return null;
    }

    console.log('[PushSetup] FCM credentials not found in GlobalSecrets, skipping FCM setup');
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
 * Main handler
 */
export const handler = async (event: CloudFormationEvent): Promise<void> => {
    console.log('[PushSetup] Event:', JSON.stringify(event, null, 2));

    const physicalResourceId = event.PhysicalResourceId || `push-platform-setup-${Date.now()}`;

    try {
        if (event.RequestType === 'Delete') {
            // On delete, we could clean up platform apps, but they're usually retained
            // for continuity. Just return success.
            console.log('[PushSetup] Delete request - platform apps will be retained');
            await sendResponse(event, 'SUCCESS', physicalResourceId, {});
            return;
        }

        // Create or Update
        console.log(`[PushSetup] ${event.RequestType} request - setting up platform apps`);

        const fcmArn = await setupFCM();
        const apnsResult = await setupAPNS();

        const data: Record<string, string> = {};
        if (fcmArn) data.FcmPlatformArn = fcmArn;
        if (apnsResult.production) data.ApnsPlatformArn = apnsResult.production;
        if (apnsResult.sandbox) data.ApnsSandboxPlatformArn = apnsResult.sandbox;

        console.log('[PushSetup] Setup complete:', data);

        await sendResponse(event, 'SUCCESS', physicalResourceId, data);
    } catch (error: any) {
        console.error('[PushSetup] Error:', error);
        await sendResponse(event, 'FAILED', physicalResourceId, {}, error.message);
    }
};
